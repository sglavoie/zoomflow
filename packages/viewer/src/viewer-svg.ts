import { shapeClass, type Board, type LintDiagnostic, type ShapeSource } from '@zoomflow/core';
import { restoreMissingLinks } from './missing-links';
import { prepareLinks, type resolveLink } from './links';
import { sanitizeSvg } from './sanitize';
import { associateShapeBadges } from './shape-badges';
import { libraryTheme } from './library-theme';

/** Parse inert renderer output, sanitize it, and annotate interactive shapes and links. */
export function viewerSvg(svg: string, board: Board, boards: ReadonlyMap<string, Board>,
  diagnostics: readonly LintDiagnostic[], sourceShapes: readonly ShapeSource[],
  resolve: (href: string) => ReturnType<typeof resolveLink>): SVGElement {
  const doc = new DOMParser().parseFromString(libraryTheme(svg), 'image/svg+xml');
  // File content can contain labels and links; never insert executable markup. Sanitize while
  // the parsed SVG is still inert: importing an element into this document can start loading it.
  if (doc.querySelector('parsererror') || !sanitizeSvg(doc.documentElement)) throw new Error(`Invalid SVG for ${board.name}`);
  const element = document.importNode(doc.documentElement, true) as unknown as SVGElement;
  element.setAttribute('preserveAspectRatio', 'xMidYMid meet');
  associateShapeBadges(element, board);
  restoreMissingLinks(element, diagnostics.filter((item) => item.board === board.id));
  prepareLinks(element, resolve, (id) => boards.get(id)?.hash);
  // The first group in document order carrying each class, and this board's source shapes.
  const groups = new Map<string, SVGGElement>();
  for (const node of element.querySelectorAll('g')) for (const name of node.classList) if (!groups.has(name)) groups.set(name, node);
  const sources = new Set(sourceShapes.filter((entry) => entry.board === board.id).map((entry) => entry.shape));
  for (const shape of board.diagram.shapes) {
    const group = groups.get(shapeClass(shape.id));
    if (group) {
      group.dataset.shapeId = shape.id;
      group.dataset.shapeBoard = board.id;
      if (!group.closest('a')) {
        group.setAttribute('tabindex', '0');
        group.setAttribute('role', 'button');
        group.setAttribute('aria-label', `Select ${sources.has(shape.id) ? 'source for ' : ''}${group.querySelector('text')?.textContent || shape.id}`);
      }
    }
  }
  for (const edge of board.diagram.connections) {
    const group = groups.get(shapeClass(edge.id));
    if (group) {
      group.dataset.connectionId = edge.id;
      group.dataset.connectionBoard = board.id;
    }
  }
  return element;
}

export function syncBackground(container: HTMLElement) {
  const background = container.querySelector<SVGRectElement>('svg svg > rect');
  container.style.backgroundColor = background ? getComputedStyle(background).fill : '';
}
