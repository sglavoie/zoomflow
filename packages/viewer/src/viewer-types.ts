import type { DocumentView } from './document-view';

export type RenderBoard = (target: string) => Promise<string>;
/** Compilation succeeded, but its preview could not be rendered or read as SVG. */
export class ViewerRenderError extends Error {
  constructor(cause: unknown) { super('The preview could not be drawn.', { cause }); }
}
export type ViewerRoute = { hash: string; trail?: unknown };
export type ViewerOptions = {
  /** A human-readable title for this document's root breadcrumb. */
  name?: () => string | undefined;
  /** Mirror the current board in the page URL and history; otherwise keep the route in memory. */
  history?: boolean;
  /** Whether page-level Escape/Backspace should navigate this viewer. */
  active?: () => boolean;
  /** Whether a click or Enter on a link opens it; by default every one does. */
  follows?: (link: Element, event: MouseEvent | KeyboardEvent) => boolean;
  /** Other diagram files that links can open, by path relative to this document as authored.
   * Without it, file links show as missing and explain that the folder must be opened. */
  /** `name`: the open file's name, which its root board's crumb shows in place of Root. */
  files?: { exists(path: string): boolean; open(path: string, hash: string): void; label?(path: string): string; name?(): string | undefined };
  /** Escape/Backspace on the root board: return true when it went somewhere, such as back to the file that opened this one. */
  onTopLevelBack?: () => boolean;
  /** With `history`, the open document: its key goes into every history entry as `zoomflowFile`. When Back or
   * Forward reaches another document's entry, `restore` gets that entry's state and returns true when it opens
   * the document; otherwise the entry's board opens in this one. */
  document?: { key(): string | undefined; restore(state: { zoomflowFile: string } & Record<string, unknown>): boolean };
  /** The host owns persistence and shares explicit visibility choices across viewers and exports. */
  view?: { read(key: string): DocumentView; write(key: string, patch: DocumentView): void };
};
export type TrailPrefixEntry = { name: string; activate(): void };
export const openFolderMessage = 'Open the folder that contains this file to follow links to other diagrams.';
