import { indexBoards, type Board, type Diagram } from '@zoomflow/core';
import { composeLayers, layerDepths, visibleLayers } from './layers';
import { diagramHiddenShapes, filterHiddenSvg, markHiddenShapes, removeHiddenShapes, visibleDiagram } from './visibility';
import { fitExportBounds } from './export-bounds';
import type { DocumentView } from './document-view';
import type { RenderBoard, ViewerOptions } from './viewer-types';

type LayerView = { root?: string; expanded: Set<string>; all: boolean; depth?: number };
export interface ViewerViewContext {
  hiddenShapes: Map<string, Set<string>>;
  current: string;
  boards: Map<string, Board>;
  stage: HTMLDivElement;
  layerDocument: string | undefined;
  settings: ViewerOptions;
  layerView: LayerView;
  showBoard: (id: string, mode: "push" | "replace", trail?: string[], preserveViewport?: boolean, notice?: string) => Promise<void>;
  ancestors: (id: string) => string[];
  hiddenDocuments: Map<string, Map<string, Set<string>>>;
  navigationError: (error: unknown) => void;
  cache: Map<string, Promise<string>>;
  render: RenderBoard;
  svgElement: (svg: string, board: Board) => SVGElement;
  layerViews: Map<string, LayerView>;
}

/** Visibility, connected layers, and the view retained for each document. */
export class ViewerView {
  constructor(private readonly ctx: ViewerViewContext) {}

  get hasExportVisibilityChoices() { return [...this.ctx.hiddenShapes.values()].some(ids => ids.size > 0); }

  isShapeHidden(shape: string, board = this.ctx.current) {
    return diagramHiddenShapes(this.ctx.boards, this.ctx.hiddenShapes).get(board)?.has(shape) ?? false;
  }

  /** Unhiding a descendant clears the parent choices hiding it; other explicit choices are preserved. */
  toggleShapeHidden(shape: string, board = this.ctx.current) {
    const model = this.ctx.boards.get(board);
    if (!model?.diagram.shapes.some(item => item.id === shape)) return;
    const choices = this.ctx.hiddenShapes.get(board) ?? new Set<string>();
    if (this.isShapeHidden(shape, board)) {
      for (const [origin, selected] of this.ctx.hiddenShapes) for (const id of selected) {
        if (diagramHiddenShapes(this.ctx.boards, new Map([[origin, new Set([id])]])).get(board)?.has(shape)) selected.delete(id);
      }
    } else choices.add(shape);
    this.ctx.hiddenShapes.set(board, choices);
    this.applyVisibility();
    this.saveVisibility();
    this.ctx.stage.dispatchEvent(new Event('zf-visibilitychange'));
  }

  /** Restore every board in this document without changing its source or layer layout. */
  resetExportVisibility() {
    this.ctx.hiddenShapes = new Map();
    this.applyVisibility();
    this.saveVisibility();
    this.ctx.stage.dispatchEvent(new Event('zf-visibilitychange'));
  }

  private saveVisibility() {
    if (this.ctx.layerDocument !== undefined) this.ctx.settings.view?.write(this.ctx.layerDocument,
      { hidden: [...this.ctx.hiddenShapes].map(([board, ids]) => [board, [...ids]]) });
  }

  /** A sibling viewer changed this document's canonical visibility choices. */
  refreshVisibility(key: string) {
    if (key !== this.ctx.layerDocument || !this.ctx.settings.view) return;
    this.ctx.hiddenShapes = new Map((this.ctx.settings.view.read(key).hidden ?? []).map(([board, ids]) => [board, new Set(ids)]));
    this.applyVisibility();
    this.ctx.stage.dispatchEvent(new Event('zf-visibilitychange'));
  }

  saveLayers() {
    if (this.ctx.layerDocument !== undefined) this.ctx.settings.view?.write(this.ctx.layerDocument,
      { layers: { ...this.ctx.layerView, expanded: [...this.ctx.layerView.expanded] } });
  }

  /** A copy of explicit view choices, for source transactions that move shapes between boards. */
  get documentView(): DocumentView {
    return { hidden: [...this.ctx.hiddenShapes].map(([board, ids]) => [board, [...ids]]),
      layers: { ...this.ctx.layerView, expanded: [...this.ctx.layerView.expanded] } };
  }

  /** Apply relocated choices after the replacement source has compiled under its document key. */
  async restoreDocumentView(view: DocumentView, focusBoard = this.ctx.current) {
    this.ctx.hiddenShapes = new Map((view.hidden ?? []).map(([board, ids]) => [board, new Set(ids)]));
    this.ctx.layerView = view.layers ? { ...view.layers, expanded: new Set(view.layers.expanded) } : { expanded: new Set(), all: false };
    if (this.ctx.layerView.root && !this.ctx.boards.has(this.ctx.layerView.root)) this.ctx.layerView.root = 'root';
    this.refreshLayerExpansion();
    if (this.ctx.layerView.root && this.ctx.boards.has(focusBoard) && !this.layerState.visible.has(focusBoard)) {
      this.ctx.layerView.depth = undefined;
      this.ctx.layerView.all = false;
      this.ensureLayerPath(focusBoard);
    }
    this.saveVisibility();
    this.saveLayers();
    const active = this.ctx.boards.has(focusBoard) ? focusBoard : 'root';
    await this.ctx.showBoard(active, 'replace', this.ctx.ancestors(active));
    this.ctx.stage.dispatchEvent(new Event('zf-visibilitychange'));
    this.ctx.stage.dispatchEvent(new Event('zf-layerchange'));
  }

  applyVisibility(root: Element = this.ctx.stage) {
    const hidden = diagramHiddenShapes(this.ctx.boards, this.ctx.hiddenShapes);
    for (const node of root.querySelectorAll('.zf-hidden-label')) node.remove();
    for (const board of this.ctx.boards.values()) {
      const container = this.ctx.layerView.root
        ? [...root.querySelectorAll<SVGElement>('[data-layer-board]')].find(node => node.dataset.layerBoard === board.id)
        : board.id === this.ctx.current ? root : undefined;
      if (container) markHiddenShapes(container, board, hidden.get(board.id)!);
    }
    for (const connector of root.querySelectorAll<SVGElement>('.zf-layer-connectors [data-layer-source]')) {
      connector.toggleAttribute('data-export-hidden', hidden.get(connector.dataset.layerParent!)?.has(connector.dataset.layerSource!) ?? false);
    }
  }

  /** Snapshot choices so an asynchronous export uses one consistent view, including search metadata. */
  exportView(diagram: Diagram, render: RenderBoard, key = this.ctx.layerDocument) {
    const choices = this.ctx.settings.view && key !== undefined
      ? new Map((this.ctx.settings.view.read(key).hidden ?? []).map(([board, ids]) => [board, new Set(ids)]))
      : key === this.ctx.layerDocument ? this.ctx.hiddenShapes : this.ctx.hiddenDocuments.get(key ?? '') ?? new Map<string, Set<string>>();
    const boards = indexBoards(diagram);
    const hidden = diagramHiddenShapes(boards, choices);
    const byTarget = new Map([...boards.values()].map(board => [board.target, board]));
    return { diagram: visibleDiagram(diagram, hidden), render: async (target: string) => {
      const svg = await render(target);
      const board = byTarget.get(target);
      return board ? filterHiddenSvg(svg, board, hidden.get(board.id)!) : svg;
    } };
  }

  hiddenShapeCount(boards: Iterable<string> = this.ctx.boards.keys()) {
    const hidden = diagramHiddenShapes(this.ctx.boards, this.ctx.hiddenShapes);
    let count = 0;
    for (const id of boards) {
      count += hidden.get(id)?.size ?? 0;
    }
    return count;
  }

  get layerState() {
    const root = this.ctx.layerView.root;
    const visible = new Set(root ? visibleLayers(this.ctx.boards, root, this.ctx.layerView.expanded).map(board => board.id) : [this.ctx.current]);
    const depths = layerDepths(this.ctx.boards, root ?? this.ctx.current);
    const available = new Set(depths.keys());
    let maxDepth = 0;
    let visibleDepth = 0;
    for (const [id, depth] of depths) {
      maxDepth = Math.max(maxDepth, depth);
      if (visible.has(id)) visibleDepth = Math.max(visibleDepth, depth);
    }
    const uniform = [...depths].every(([id, depth]) => visible.has(id) === (depth <= visibleDepth));
    return { enabled: Boolean(root), root, available, expanded: this.ctx.layerView.expanded as ReadonlySet<string>, visible,
      depth: uniform ? visibleDepth : null, visibleDepth, maxDepth,
      all: root === this.ctx.current && [...available].every(id => visible.has(id)) };
  }

  /** Show the active board and all its descendants, or return to that board alone. */
  async setAllLayers(show: boolean) {
    await this.changeLayers(() => {
      this.ctx.layerView = show ? { root: this.ctx.current, expanded: new Set(this.ctx.boards.keys()), all: true }
        : { expanded: new Set(), all: false };
    });
  }

  /** Show the view's starting board plus a chosen number of descendant levels. */
  async setLayerDepth(depth: number) {
    if (!Number.isSafeInteger(depth) || depth < 0 || !this.ctx.boards.has(this.ctx.current)) return;
    await this.changeLayers(() => {
      this.ctx.layerView = { root: this.ctx.layerView.root ?? this.ctx.current, expanded: new Set(), all: false, depth };
      this.refreshLayerExpansion();
    });
  }

  refreshLayerExpansion() {
    if (!this.ctx.layerView.root) return;
    if (this.ctx.layerView.all) this.ctx.layerView.expanded = new Set(this.ctx.boards.keys());
    else if (this.ctx.layerView.depth !== undefined) this.ctx.layerView.expanded = new Set(
      [...layerDepths(this.ctx.boards, this.ctx.layerView.root)].filter(([, depth]) => depth <= this.ctx.layerView.depth!).map(([id]) => id));
  }

  /** Hiding a parent collapses its subtree but remembers the children's choices. */
  async setLayerVisible(id: string, show: boolean) {
    if (this.ctx.boards.get(id)?.kind !== 'layers') return;
    const root = this.ctx.layerView.root ?? this.ctx.current;
    if (id === root || !this.layerState.available.has(id)) return;
    await this.changeLayers(() => {
      this.ctx.layerView = { ...this.ctx.layerView, expanded: new Set(this.ctx.layerView.expanded), all: false, depth: undefined };
      this.ctx.layerView.root ??= this.ctx.current;
      if (show) this.ensureLayerPath(id);
      else this.ctx.layerView.expanded.delete(id);
    });
  }

  ensureLayerPath(id: string) {
    if (!this.ctx.layerView.root) return;
    const path = this.ctx.ancestors(id);
    const from = path.indexOf(this.ctx.layerView.root);
    if (from < 0 || path.slice(from + 1).some(child => this.ctx.boards.get(child)?.kind !== 'layers')) this.ctx.layerView.root = id;
    else for (const child of path.slice(from + 1)) this.ctx.layerView.expanded.add(child);
  }

  private async changeLayers(change: () => void) {
    const before = this.ctx.layerView;
    change();
    const next = this.ctx.layerView;
    this.ctx.stage.dispatchEvent(new Event('zf-layerchange'));
    let active = this.ctx.current;
    const visible = this.layerState.visible;
    while (!visible.has(active) && this.ctx.boards.get(active)?.parent) active = this.ctx.boards.get(active)!.parent!;
    try { await this.ctx.showBoard(active, 'replace', this.ctx.ancestors(active)); }
    catch (error) {
      if (this.ctx.layerView === next) { this.ctx.layerView = before; this.ctx.stage.dispatchEvent(new Event('zf-layerchange')); }
      this.ctx.navigationError(error);
    }
  }

  cachedRender(board: Board) {
    let rendered = this.ctx.cache.get(board.id);
    if (!rendered) {
      rendered = this.ctx.render(board.target);
      const cache = this.ctx.cache;
      cache.set(board.id, rendered);
      void rendered.catch(() => cache.delete(board.id));
    }
    return rendered;
  }

  async layerSvg(exporting = false) {
    let boards = visibleLayers(this.ctx.boards, this.ctx.layerView.root!, this.ctx.layerView.expanded);
    const hidden = exporting ? diagramHiddenShapes(this.ctx.boards, this.ctx.hiddenShapes) : undefined;
    const trim = Boolean(hidden && boards.some(board => hidden.get(board.id)?.size));
    if (trim) {
      const retained = new Set([boards[0].id]);
      for (const board of boards) if (!board.diagram.shapes.length || board.diagram.shapes.some(shape => !hidden!.get(board.id)!.has(shape.id))) {
        for (const id of this.ctx.ancestors(board.id)) retained.add(id);
      }
      boards = boards.filter(board => retained.has(board.id));
    }
    const items: { board: Board; svg: SVGElement }[] = [];
    // Bound render work when a large hierarchy is expanded at once.
    for (let i = 0; i < boards.length; i += 4) {
      items.push(...await Promise.all(boards.slice(i, i + 4).map(async board => {
        const svg = this.ctx.svgElement(await this.cachedRender(board), board);
        const omitted = hidden?.get(board.id);
        if (trim && omitted?.size) {
          markHiddenShapes(svg, board, omitted);
          removeHiddenShapes(svg);
          await fitExportBounds(svg as SVGSVGElement);
          board = { ...board, diagram: { ...board.diagram, shapes: board.diagram.shapes.filter(shape => !omitted.has(shape.id)),
            connections: board.diagram.connections.filter(edge => !omitted.has(edge.src) && !omitted.has(edge.dst)) } };
        }
        return { board, svg };
      })));
    }
    const svg = composeLayers(items);
    if (trim) svg.setAttribute('data-export-trim', '');
    return svg;
  }

  /** A fresh full-size SVG of the visible layers, without selection rings or viewport transforms. */
  async renderVisibleLayers() {
    if (!this.ctx.layerView.root) return undefined;
    const svg = await this.layerSvg(true);
    this.applyVisibility(svg);
    removeHiddenShapes(svg);
    return new XMLSerializer().serializeToString(svg);
  }

  /** Saving a draft under a new key preserves its view and leaves the original document's choices available. */
  copyLayerDocument(key: string) {
    if (this.ctx.layerDocument !== undefined) this.ctx.layerViews.set(this.ctx.layerDocument, this.ctx.layerView);
    this.ctx.layerView = { ...this.ctx.layerView, expanded: new Set(this.ctx.layerView.expanded) };
    if (this.ctx.layerDocument !== undefined) this.ctx.hiddenDocuments.set(this.ctx.layerDocument, this.ctx.hiddenShapes);
    this.ctx.hiddenShapes = new Map([...this.ctx.hiddenShapes].map(([board, shapes]) => [board, new Set(shapes)]));
    this.ctx.layerDocument = key;
    this.saveVisibility();
    this.saveLayers();
  }
}
