import type { DocumentView } from '@zoomflow/viewer';
import type { BuilderTarget } from './builder-dialog';
import type { BuilderKind } from './board-model';
import type { FileBoard } from './file-link-dialog';
import type { ProjectSearchHost } from './project-search';
import type { ProjectCheckHost } from './project-check';

/** What a folder project offers for linking its files: this document's project path, the other files, a file's
 * boards, and opening or creating a file. `create` resolves the new file's project path, or undefined when it failed. */
export type FileLinkHost = {
  /** The draft requesting the link; a delayed file write must not change another document. */
  key: string;
  path: string;
  files: string[];
  boards: (path: string) => Promise<FileBoard[]>;
  open: (link: string) => void;
  create: (name: string, source: string) => Promise<string | undefined>;
};
export type Builder = { open: (target: BuilderTarget, returnFocus: HTMLElement, fallback?: HTMLElement) => void };
export type BoardToolsOptions = {
  builders: Record<BuilderKind, Builder>;
  source: () => string;
  /** Replace the document's source with a builder's result. */
  update: (source: string) => void;
  /** Select a shape's source; `focusEditor` moves to the source editor, as Alt+click does. */
  selectSource: (shape: string, focusEditor: boolean) => void;
  /** Show a search destination in the preview, framing and selecting its shape when present. */
  revealMatch: (shape?: string) => void;
  projectSearch?: ProjectSearchHost;
  projectCheck?: ProjectCheckHost;
  /** Whether the shape's source is in this document, rather than an imported file. */
  inSource: (shape: string) => boolean;
  status: (message: string, kind?: 'info' | 'error') => void;
  undo: () => void;
  redo: () => void;
  /** Links to other files, only in folder projects. */
  files?: () => FileLinkHost | undefined;
  /** The document is generated and read-only: shapes only open the files they link to. */
  readOnly?: () => boolean;
};
export type Item = (label: string, run: (returnFocus: HTMLElement) => void, options?: { relinks?: boolean; keys?: string }) => HTMLButtonElement;

export const stale = 'This board changed while the builder was open. Close and reopen the builder to use the latest version.';
export const compiling = 'This diagram changed while the builder was open. Wait for the preview to update, then apply again.';
export const undoHint = 'Undo with ⌘Z / Ctrl+Z.';
/** Adds the next step or a subtopic; Tab stays free to leave the diagram. */
export const addKeys = '⌘/Ctrl+Enter';
export const isAdd = (event: KeyboardEvent) => event.key === 'Insert' && !event.metaKey && !event.ctrlKey && !event.shiftKey
  || event.key === 'Enter' && (event.metaKey || event.ctrlKey) && !event.shiftKey;

export type MoveState = { source: string; board: string; shape?: string; view?: DocumentView };
