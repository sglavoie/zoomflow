import { classifyHref, exportAtlasHtml, exportAtlasZip, exportBoardsHtml, exportBoardsZip, exportGlyphSource, exportProjectArchive,
  renderExportBoards, indexBoards, resolveFilePath, type AtlasDocument, type Diagram, type ExportBoard } from '@zoomflow/core';
import type { RenderBoard } from '@zoomflow/viewer';
import { prepareExportSvg, rasterizeSvg, offlineViewerScript, offlineViewerStyle } from '@zoomflow/viewer';
import type { DocumentExport, DocumentPane } from './document-pane';
import type { setupExamplePicker } from './example-picker';
import { compilerDiagnostics } from './diagnostics';
import { describeError, plural, safeFilename } from './text';
import { download, downloadSource, downloadProjectSources } from './download';
import { projectIdOf } from './project-files';

/** The project paths of the files a diagram's file links open, in board order. Connections link files too, as
 * the CLI, lint and the atlas map follow them. */
export function linkedFiles(diagram: Diagram, path: string): string[] {
  const paths: string[] = [];
  for (const board of indexBoards(diagram).values()) {
    for (const item of [...board.diagram.shapes, ...board.diagram.connections]) {
      const link = classifyHref(item.link ?? '');
      const target = link.kind === 'file' ? resolveFilePath(path, link.path) : undefined;
      if (target !== undefined && !paths.includes(target)) paths.push(target);
    }
  }
  return paths;
}

/** The header Export menu: diagram exports and source downloads for the active pane. */
export function setupExportMenu(activePane: () => DocumentPane | undefined, picker: () => ReturnType<typeof setupExamplePicker>) {
  const moreToggle = document.querySelector<HTMLButtonElement>('#header-more-toggle')!;
  const moreContent = document.querySelector<HTMLElement>('#header-more-content')!;
  const more = document.querySelector<HTMLElement>('#header-more')!;
  function setMoreOpen(open: boolean) {
    moreContent.hidden = !open;
    moreToggle.setAttribute('aria-expanded', String(open));
  }
  moreToggle.addEventListener('click', () => { showName(); setMoreOpen(Boolean(moreContent.hidden)); });
  document.addEventListener('click', (event) => { if (event.target instanceof Node && !more.contains(event.target)) setMoreOpen(false); });
  more.addEventListener('focusout', (event) => { if (event.relatedTarget instanceof Node && !more.contains(event.relatedTarget)) setMoreOpen(false); });
  more.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !moreContent.hidden) {
      event.preventDefault(); event.stopPropagation(); setMoreOpen(false); moreToggle.focus();
    }
  });

  // The name field shows the name without its extension; changing it renames the draft.
  const nameField = document.querySelector<HTMLInputElement>('#export-name')!;
  const nameHint = document.querySelector<HTMLElement>('#export-name-hint')!;
  function showName() {
    const pane = activePane();
    const project = Boolean(pane?.key && picker().projectName(pane.id));
    nameField.value = pane?.name.replace(/\.d2$/i, '') ?? '';
    nameField.disabled = !pane?.key || project;
    nameHint.textContent = project ? 'Project files keep their file name.' : 'Names the downloaded files.';
  }
  function commitName() {
    const pane = activePane();
    if (pane?.key) pane.rename(nameField.value);
    showName();
  }
  nameField.addEventListener('change', commitName);
  nameField.addEventListener('keydown', (event) => {
    // Enter commits the name and keeps focus in the open menu.
    if (event.key === 'Enter') { event.preventDefault(); commitName(); nameField.select(); }
    // Escape restores the name before the menu closes.
    else if (event.key === 'Escape') showName();
  });

  const exportStatus = document.querySelector<HTMLElement>('#export-status')!;
  const projectDownloadButton = document.querySelector<HTMLButtonElement>('#save-project')!;
  function setExportStatus(message: string, kind: 'info' | 'error' = 'info') {
    exportStatus.textContent = message;
    exportStatus.dataset.kind = kind;
    exportStatus.hidden = !message;
  }
  /** The export menu shows the result while open; the pane's live activity line announces it once. */
  function reportExport(message: string, kind: 'info' | 'error' = 'info', pane = activePane()!) {
    pane.setActivity(message, kind);
    setExportStatus(message, kind);
  }

  /** Downloads and clipboard copies use the same visible board, theme and hidden-shape choices. */
  async function boardImage(pane: DocumentPane, render: RenderBoard, target: string, dark: boolean) {
    const layers = await pane.viewer.renderVisibleLayers();
    const prepared = await prepareExportSvg(layers ?? await render(target), dark);
    return { ...prepared, layers: Boolean(layers) };
  }

  document.querySelector<HTMLButtonElement>('#save-source')!.addEventListener('click', () => {
    const pane = activePane()!;
    if (!pane.key) return;
    const name = downloadSource(pane.source, pane.name);
    picker().markDownloadRequested(pane.id);
    pane.setActivity(`Source download started: ${name}`);
  });
  projectDownloadButton.addEventListener('click', () => {
    const pane = activePane()!;
    const name = picker().projectName(pane.id);
    if (!name) return;
    try {
      const { fs, inputPath } = picker().compilation(pane.id);
      fs[inputPath] = pane.source;
      const filename = downloadProjectSources(fs, name);
      reportExport(`Project source download started: ${filename}`);
    } catch (error) { reportExport(`Project source download failed: ${describeError(error)}`, 'error'); }
  });
  const archiveButton = document.querySelector<HTMLButtonElement>('#save-archive')!;
  archiveButton.addEventListener('click', () => {
    const pane = activePane();
    if (!pane?.key) return;
    try {
      const project = picker().archiveSnapshot(pane.id);
      if (!project) return;
      const filename = `${safeFilename(project.name)}.zoomflow.zip`;
      download(new Blob([exportProjectArchive(project)], { type: 'application/zip' }), filename);
      reportExport(`Zoomflow project download started: ${filename}`, 'info', pane);
    } catch (error) { reportExport(`Project download failed: ${describeError(error)}`, 'error', pane); }
  });

  const exportButton = document.querySelector<HTMLButtonElement>('#export')!;
  const copyPngButton = document.querySelector<HTMLButtonElement>('#copy-board-png')!;
  const resetVisibility = document.querySelector<HTMLButtonElement>('#reset-export-visibility')!;
  resetVisibility.addEventListener('click', () => {
    const pane = activePane();
    if (!pane?.key) return;
    pane.viewer.resetExportVisibility();
    reportExport('Export visibility reset for every board in this diagram.');
    exportButton.focus();
  });
  const exportChoices = document.querySelector<HTMLFieldSetElement>('#export-format')!;
  const exportFormat = { get value() { return exportChoices.querySelector<HTMLInputElement>('input:checked')!.value; } };
  let explicitExportFormat = false;
  const atlasChoice = exportChoices.querySelector<HTMLInputElement>('input[value="atlas"]')!;
  /** Only project files offer the atlas; others fall back to one file's interactive HTML. */
  let wantsAtlas = false;
  const isProject = (pane: DocumentPane | undefined) => Boolean(pane?.key && picker().projectName(pane.id));
  try {
    const saved = localStorage.getItem('zoomflow.export-format');
    wantsAtlas = saved === 'atlas';
    const choice = [...exportChoices.querySelectorAll<HTMLInputElement>('input')].find(input => input.value === saved);
    if (choice) { choice.checked = true; explicitExportFormat = true; }
  } catch { /* Exporting works without stored preferences. */ }
  let exporting = false;
  const canExport = () => !exporting && Boolean(activePane()?.documentExport && activePane()!.current);
  function updateExportLabel() {
    const pane = activePane();
    if (document.activeElement !== nameField) showName();
    const documentExport = pane?.documentExport;
    archiveButton.disabled = !pane?.key;
    exportButton.disabled = !canExport();
    resetVisibility.hidden = !pane?.viewer.hasExportVisibilityChoices;
    resetVisibility.disabled = exporting || !documentExport || !pane?.viewer.hasExportVisibilityChoices;
    resetVisibility.title = 'Include every shape on every board of this diagram; keep the current layer layout.';
    const count = documentExport ? indexBoards(documentExport.diagram).size : 0;
    if (documentExport && !explicitExportFormat) {
      exportChoices.querySelector<HTMLInputElement>(`input[value="${count > 1 ? 'html' : 'svg'}"]`)!.checked = true;
    }
    const project = isProject(pane);
    atlasChoice.closest('label')!.hidden = !project;
    if (wantsAtlas) (project ? atlasChoice : exportChoices.querySelector<HTMLInputElement>('input[value="html"]')!).checked = true;
    const zip = exportFormat.value === 'zip' || exportFormat.value === 'png-zip';
    const allBoards = zip || exportFormat.value === 'html';
    const formatName = ({ svg: 'SVG', png: 'PNG', zip: 'SVG ZIP', 'png-zip': 'PNG ZIP', html: 'Interactive HTML', atlas: 'Interactive atlas HTML' } as Record<string, string>)[exportFormat.value];
    document.querySelector('#export-scope')!.textContent = documentExport
      ? exportFormat.value === 'atlas' ? `This file and every file it links to · ${formatName}`
        : allBoards ? `Entire diagram${project && zip ? ' and the files it links to' : ''} · ${plural(count, 'board')} · ${formatName}`
          : pane!.viewer.layerState.enabled ? `Visible layers · ${plural(pane!.viewer.layerState.visible.size, 'layer')} · ${formatName}`
            : `Current board: ${pane!.viewer.currentBoard?.name ?? 'Root'} · ${formatName}`
      : pane?.sourceError ? 'Fix source errors to export.' : 'Compile the current source to export a diagram.';
    if (documentExport) {
      const hidden = pane!.viewer.hiddenShapeCount(allBoards || exportFormat.value === 'atlas' ? undefined : pane!.viewer.layerState.visible);
      if (hidden) document.querySelector('#export-scope')!.textContent += ` · ${plural(hidden, 'hidden shape')} omitted`;
    }
    exportButton.textContent = ({ svg: 'Download SVG', png: 'Download PNG', zip: 'Download SVG ZIP', 'png-zip': 'Download PNG ZIP',
      html: 'Download HTML', atlas: 'Download atlas HTML' } as Record<string, string>)[exportFormat.value] ?? 'Download export';
    copyPngButton.hidden = exportFormat.value !== 'png';
    copyPngButton.disabled = !canExport();
  }
  function rememberExportFormat() {
    explicitExportFormat = true;
    wantsAtlas = exportFormat.value === 'atlas';
    try { localStorage.setItem('zoomflow.export-format', exportFormat.value); } catch { /* Optional preference. */ }
    updateExportLabel();
  }
  exportChoices.addEventListener('change', rememberExportFormat);
  exportChoices.addEventListener('click', (event) => {
    // Clicking the automatically selected format is still an explicit choice.
    if (event.target instanceof HTMLInputElement && event.target.checked) rememberExportFormat();
  });

  copyPngButton.addEventListener('click', async () => {
    const pane = activePane();
    const loaded = pane?.documentExport;
    const board = pane?.viewer.currentBoard;
    if (!pane || !loaded || !board || !canExport()) return;
    if (!navigator.clipboard?.write || typeof ClipboardItem === 'undefined') {
      reportExport('Clipboard unavailable. Use Download PNG.', 'error', pane);
      return;
    }
    const revision = pane.generation;
    const view = pane.viewer.exportView(loaded.diagram, loaded.render);
    const dark = document.documentElement.dataset.theme === 'dark';
    const canceled = () => pane.generation !== revision || pane.documentExport !== loaded ||
      pane.viewer.currentBoard?.id !== board.id || activePane() !== pane;
    exporting = true;
    updateExportLabel();
    reportExport('Preparing PNG to copy…', 'info', pane);
    let warnings: string[] = [];
    let preparationError: unknown;
    // Start the clipboard write during the click's user activation. The browser
    // awaits this promise while rendering and PNG encoding finish.
    const image = (async () => {
      try {
        const prepared = await boardImage(pane, view.render, board.target, dark);
        warnings = prepared.warnings;
        const png = await rasterizeSvg(prepared.svg);
        if (canceled()) throw new Error('The diagram changed while copying.');
        return png;
      } catch (error) { preparationError = error; throw error; }
    })();
    void image.catch(() => {});
    try {
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': image })]);
      reportExport(warnings.length ? `PNG copied. ${[...new Set(warnings)].join(' ')}` : 'PNG copied to clipboard.',
        warnings.length ? 'error' : 'info', pane);
    } catch (error) {
      const changed = canceled();
      reportExport(changed ? 'Copy canceled because the diagram changed.'
        : `Could not copy PNG: ${describeError(preparationError ?? error)}. Use Download PNG.`,
      changed ? 'info' : 'error', pane);
    } finally { exporting = false; updateExportLabel(); }
  });

  exportButton.addEventListener('click', async () => {
    const pane = activePane()!;
    const loaded = pane.documentExport;
    const board = pane.viewer.currentBoard;
    if (!loaded || !board || !canExport()) return;
    const exportRevision = pane.generation;
    const view = pane.viewer.exportView(loaded.diagram, loaded.render);
    exporting = true;
    exportButton.disabled = true;
    copyPngButton.disabled = true;
    const format = exportFormat.value;
    const pngZip = format === 'png-zip';
    const zip = format === 'zip' || pngZip;
    const formatName = pngZip ? 'PNG ZIP' : format === 'zip' ? 'SVG ZIP' : format === 'atlas' ? 'atlas' : format.toUpperCase();
    const renderOptions = { extension: pngZip ? 'png' as const : 'svg' as const };
    reportExport(`Preparing ${formatName} download…`, 'info', pane);
    const dark = document.documentElement.dataset.theme === 'dark';
    const exportName = pane.name.replace(/\.d2$/i, '');
    const warnings: string[] = [];
    // Interactive HTML follows its reader's color scheme; images keep the theme shown here.
    const interactive = format === 'html' || format === 'atlas';
    const theme = interactive ? undefined : dark;
    const prepareWith = (render: RenderBoard) => async (target: string) => {
      const result = await prepareExportSvg(await render(target), theme, { interactive });
      warnings.push(...result.warnings);
      return result.svg;
    };
    const prepare = prepareWith(view.render);
    const canceled = () => exportRevision !== pane.generation || pane.documentExport !== loaded;
    /** Rasterize one board at a time; board IDs repeat across project files. */
    async function zipDownload(documents: AtlasDocument[], project = false): Promise<Blob> {
      const images = new Map<string, Uint8Array>();
      const key = (file: string, id: string) => JSON.stringify([file, id]);
      if (pngZip) {
        for (const document of documents) {
          for (const board of document.boards) {
            reportExport(`Preparing PNG ZIP: ${document.path ? `${document.path} · ` : ''}${board.path}…`, 'info', pane);
            images.set(key(project ? document.path : '', board.id), new Uint8Array(await (await rasterizeSvg(board.svg)).arrayBuffer()));
          }
        }
      }
      const contents = pngZip ? (board: ExportBoard) => images.get(key(board.file ?? '', board.id))! : undefined;
      return new Blob([project ? exportAtlasZip(documents, contents) : exportBoardsZip(documents[0].boards, contents)], { type: 'application/zip' });
    }
    /** This file and every project file its file links reach, breadth first, each once. */
    async function atlasDocuments(): Promise<AtlasDocument[] | undefined> {
      const { fs, inputPath } = picker().compilation(pane.id);
      fs[inputPath] = pane.source;
      const queue = [inputPath];
      const documents: AtlasDocument[] = [];
      for (const [index, path] of queue.entries()) {
        reportExport(`Preparing ${formatName}: ${path} (${index + 1} of ${queue.length})…`, 'info', pane);
        let file: Pick<DocumentExport, 'diagram' | 'render' | 'diagnostics'> = { ...loaded!, ...view };
        if (index) {
          try { file = await pane.compileProjectFile(path, fs); }
          catch (error) {
            // Links to a file that does not compile stay, marked missing.
            warnings.push(`Left out ${path}: ${compilerDiagnostics(error, fs[path] ?? '', path).map((item) => item.message).join(' ')}`);
            continue;
          }
          file = { ...file, ...pane.viewer.exportView(file.diagram, file.render, `project:${projectIdOf(pane.key!)}:${path}`) };
        }
        if (canceled()) return undefined;
        const boards = await renderExportBoards(file.diagram, prepareWith(file.render), file.diagnostics, renderOptions);
        if (canceled()) return undefined;
        documents.push({ path, name: path.replace(/\.d2$/i, ''), boards });
        for (const linked of linkedFiles(file.diagram, path)) if (Object.hasOwn(fs, linked) && !queue.includes(linked)) queue.push(linked);
      }
      return documents;
    }
    try {
      let blob: Blob;
      let name = safeFilename(exportName);
      if (format === 'svg' || format === 'png') {
        const prepared = await boardImage(pane, view.render, board.target, dark);
        warnings.push(...prepared.warnings);
        blob = format === 'png' ? await rasterizeSvg(prepared.svg) : new Blob([prepared.svg], { type: 'image/svg+xml' });
        name += `-${prepared.layers ? 'layers' : board.name === 'Root' ? 'root' : safeFilename(board.name)}.${format}`;
      } else if (format === 'atlas' || (zip && isProject(pane))) {
        const documents = await atlasDocuments();
        if (!documents) {
          reportExport('Export canceled because the source changed.', 'info', pane);
          return;
        }
        if (zip) {
          blob = await zipDownload(documents, true);
          name += pngZip ? '-png.zip' : '.zip';
        } else {
          const boards = documents.flatMap((document) => document.boards);
          const glyphSource = exportGlyphSource(boards);
          const glyphs = glyphSource ? await loaded.renderSource(glyphSource).catch(() => undefined) : undefined;
          blob = new Blob([exportAtlasHtml(documents, { title: exportName, script: offlineViewerScript(),
            style: offlineViewerStyle, glyphs })], { type: 'text/html' });
          name += '-atlas.html';
        }
      } else {
        const boards = await renderExportBoards(view.diagram, prepare, loaded.diagnostics, renderOptions);
        // Shared font subsets are an optimization; each board keeps its own fonts without them.
        const glyphSource = format === 'html' ? exportGlyphSource(boards) : undefined;
        const glyphs = glyphSource ? await loaded.renderSource(glyphSource).catch(() => undefined) : undefined;
        blob = zip ? await zipDownload([{ path: '', name: exportName, boards }])
          : new Blob([exportBoardsHtml(boards, { title: exportName, script: offlineViewerScript(),
            style: offlineViewerStyle, glyphs })], { type: 'text/html' });
        name += pngZip ? '-png.zip' : `.${format}`;
      }
      if (canceled()) {
        reportExport('Export canceled because the source changed.', 'info', pane);
        return;
      }
      download(blob, name);
      const result = warnings.length ? `Download started: ${name}. ${[...new Set(warnings)].join(' ')}` : `Download started: ${name}`;
      reportExport(result, warnings.length > 0 ? 'error' : 'info', pane);
    } catch (error) {
      reportExport(`Export failed: ${describeError(error)}`, 'error', pane);
    }
    finally { exporting = false; updateExportLabel(); }
  });

  return {
    setExportStatus,
    updateExportLabel,
    /** Only project files offer the whole project as a download. */
    showProjectDownload(project: boolean) { projectDownloadButton.hidden = !project; },
  };
}
