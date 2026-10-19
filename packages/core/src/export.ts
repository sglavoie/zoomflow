import { strToU8, zipSync } from 'fflate';
import { indexBoards, type Diagram } from './index';
import type { LintDiagnostic } from './lint';
import { parentContext, type ParentContext } from './context';

export interface ExportBoard {
  id: string;
  name: string;
  hash: string;
  parent?: string;
  path: string;
  empty: boolean;
  svg: string;
  missingLinks?: LintDiagnostic[];
  parentContext?: ParentContext[];
}

/** Encode each name independently: slashes and dot segments cannot escape the ZIP. */
function segment(name: string): string {
  return encodeURIComponent(name).replace(/\./g, '%2E').replace(/@/g, '%40');
}

/** Render every tree node exactly once, including unlinked and empty boards. */
export async function renderExportBoards(diagram: Diagram, render: (target: string) => Promise<string>, diagnostics: readonly LintDiagnostic[] = []): Promise<ExportBoard[]> {
  const result: ExportBoard[] = [];
  const paths = new Map<string, string>();
  const boards = indexBoards(diagram);
  for (const board of boards.values()) {
    const prefix = board.parent ? paths.get(board.parent)! : '';
    const path = board.parent
      ? `${prefix}${board.kind === 'layers' ? '' : `@${board.kind}/`}${segment(board.name)}/` : '';
    paths.set(board.id, path);
    result.push({ id: board.id, name: board.name, hash: board.hash, parent: board.parent,
      path: board.parent ? `${path.slice(0, -1)}.svg` : 'root.svg',
      empty: board.diagram.shapes.length === 0, svg: await render(board.target),
      parentContext: parentContext(board, boards),
      missingLinks: diagnostics.filter((item) => item.rule === 'dangling-link' && item.board === board.id && item.shape && item.target) });
  }
  // A layer named root would otherwise collide with the root document.
  const used = new Set<string>();
  for (const board of result) {
    let path = board.path;
    while (used.has(path)) path = `@${path}`;
    used.add(path);
    board.path = path;
  }
  return result;
}

export function exportBoardsZip(boards: readonly ExportBoard[]): Uint8Array<ArrayBuffer> {
  const files: Record<string, Uint8Array> = Object.create(null);
  for (const board of boards) {
    if (files[board.path]) throw new Error(`Duplicate export path: ${board.path}`);
    files[board.path] = strToU8(board.svg);
  }
  return new Uint8Array(zipSync(files));
}

/** The caller supplies its DOM runtime; core stays usable in Node without a DOM. */
export function exportBoardsHtml(boards: readonly ExportBoard[], options: { title: string; script: string; style: string }): string {
  const title = options.title.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);
  // SVG labels can contain HTML closing tags. Never embed unescaped JSON in a script.
  const data = JSON.stringify(boards).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title><style>${options.style}</style></head><body>
<header><strong>${title}</strong></header><main id="viewer"><nav class="zf-breadcrumbs" aria-label="Breadcrumb"></nav><div class="zf-context" role="group" aria-label="Parent connections" hidden></div><div class="zf-message" role="status"></div><div class="zf-visually-hidden" aria-live="polite"></div><div class="zf-stage" role="region" aria-label="Diagram" tabindex="-1"></div></main>
<footer>Click a linked shape to explore · Esc or Backspace goes up</footer>
<script id="zoomflow-data" type="application/json">${data}</script><script>${options.script}</script></body></html>`;
}
