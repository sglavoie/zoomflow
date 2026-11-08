import type { Diagram, DiagramSearchEntry, LintDiagnostic } from '@zoomflow/core';
import type { DocumentView, RenderBoard, ViewerRoute } from '@zoomflow/viewer';
import type { createCompiler } from './compiler';
import { projectIdOf } from './project-files';
import type { DirectoryHandles, FileHandles } from './file-handles';
import type { setupFlowBuilder } from './flow-builder';
import type { setupMindMapBuilder } from './mind-map-builder';
import type { setupExamplePicker } from './example-picker';
import type { PaneId } from './pane-scope';
import type { EngineNotice } from './engine-notice';
import { setText } from './text';

export type DocumentExport = { diagram: Diagram; render: RenderBoard; name: string; diagnostics: LintDiagnostic[];
  /** Render standalone D2 source with the document's fonts, for shared export font subsets. */
  renderSource: (source: string) => Promise<string> };

/** What the panes share: one compiler, the draft library and the page-level controls. */
export type PaneContext = {
  compiler: ReturnType<typeof createCompiler>;
  picker: () => ReturnType<typeof setupExamplePicker>;
  flowBuilder: ReturnType<typeof setupFlowBuilder>;
  mindMapBuilder: ReturnType<typeof setupMindMapBuilder>;
  engine: EngineNotice;
  fileHandles: FileHandles;
  /** The folder each project was opened from, for creating new linked files in it. */
  directoryHandles: DirectoryHandles;
  documentRoutes: Map<string, ViewerRoute>;
  isActive: () => boolean;
  /** Whether this pane shows one view at a time (narrow screens and split tabs). */
  tabbed: () => boolean;
  exportChanged: () => void;
  setExportStatus: (message: string, kind?: 'info' | 'error') => void;
  clearFileError: () => void;
  /** A canonical project source changed; other open files may import it. */
  projectChanged: (projectId: string) => void;
  /** A save follows its document if it moved to another pane during the write. */
  adoptSaved: (key: string, saved: { key: string; name: string }) => void;
  /** Select a source location in the pane that shows it. */
  revealSource: (pane: PaneId, range?: { from: number; to: number }) => void;
  /** Activate the pane already showing a project search result and reveal it there. */
  revealMatch: (pane: PaneId, entry: DiagramSearchEntry) => Promise<void>;
  /** The lint options changed in this pane; other panes follow. */
  lintChanged: () => void;
  viewChanged: (key: string, patch: DocumentView) => void;
};

/** A visible status line announced through polite and assertive live regions that keep their roles.
 * Settled info hides after a few seconds. */
export function statusLine(element: HTMLElement) {
  const regions = document.createElement('span');
  regions.className = 'zf-visually-hidden';
  regions.innerHTML = '<span role="status"></span><span role="alert" hidden></span>';
  element.after(regions);
  const [polite, assertive] = regions.children as unknown as [HTMLElement, HTMLElement];
  let timer: ReturnType<typeof setTimeout> | undefined;
  return (message: string, kind: 'info' | 'error' = 'info') => {
    clearTimeout(timer);
    setText(element, message);
    element.title = message;
    element.dataset.kind = kind;
    element.hidden = !message;
    setText(polite, kind === 'info' ? message : '');
    setText(assertive, kind === 'error' ? message : '');
    assertive.hidden = !assertive.textContent;
    if (message && kind === 'info' && !message.endsWith('…')) timer = setTimeout(() => { element.hidden = true; setText(polite, ''); }, 4000);
  };
}

/** A file or atlas map a pane came through, and the board it was left on. */
export type FileVisit = { key: string; path: string; route: ViewerRoute };
/** Board hashes of each project file's last compile, by draft key, for checking links into that file. */
export const compiledBoards = new Map<string, ReadonlySet<string>>();
/** The draft key of another file in the project of `key`. */
export const siblingKey = (key: string, path: string) => `project:${projectIdOf(key)}:${path}`;
export const projectLabel = (path: string) => path.replace(/\.d2$/i, '');

export const atlasReadOnly = 'The atlas map is drawn from the project files and is read-only. Open a file to edit it.';
