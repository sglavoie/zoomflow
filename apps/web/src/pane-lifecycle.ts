import { atlasReadOnly, type DocumentExport, type PaneContext, type FileVisit } from './document-pane-shared';
import type { indexBoards, DiagramSearchEntry } from '@zoomflow/core';
import type { Viewer, setupViewport, RenderBoard, ViewerRoute } from '@zoomflow/viewer';
import type { SourceEditor } from './editor';
import type { createPreviewQueue } from './preview-queue';
import type { setupAiAssistant } from './ai-assistant';
import type { setupMobileView } from './mobile-view';
import { projectIdOf } from './project-files';
import type { setupBoardTools } from './board-tools';
import type { DraftState } from './example-picker';
import type { paneScope, PaneId } from './pane-scope';
import type { paneNotice } from './engine-notice';
import { canChooseSaveFile } from './save-file';
import { setText } from './text';

interface Context {
  id: PaneId;
  root: HTMLElement;
  scope: ReturnType<typeof paneScope>;
  viewer: Viewer;
  editor: SourceEditor;
  viewport: ReturnType<typeof setupViewport>;
  showView: (view: 'preview' | 'source') => void;
  views: ReturnType<typeof setupMobileView>;
  setActivity: (message: string, kind?: 'info' | 'error') => void;
  currentDocumentKey: string | undefined;
  documentName: string;
  generation: number;
  documentOpens: number;
  documentExport: DocumentExport | undefined;
  sourceError: boolean;
  documentRevision: number;
  mappedSource: string | undefined;
  load: (source: string, name: string, preserveViewport?: boolean) => Promise<void>;
  boardTools: ReturnType<typeof setupBoardTools>;
  compileProjectFile: (path: string, fs: Record<string, string>) => Promise<Pick<DocumentExport, 'diagram' | 'render' | 'diagnostics'>>;
  replaceDocument: (source: string, name: string, key: string, reset?: boolean, route?: ViewerRoute, stack?: FileVisit[]) => Promise<void>;
  adopt: (saved: { key: string; name: string; }) => void;
  showsAtlas: () => boolean;
  invalidateSource: () => void;
  debounce: ReturnType<typeof setTimeout> | undefined;
  saveFileButton: HTMLButtonElement;
  openAtlasMap: (projectId: string) => Promise<void>;
  picker: PaneContext['picker'];
  shared: PaneContext;
  ai: ReturnType<typeof setupAiAssistant> | undefined;
  setFileStack: (stack: FileVisit[]) => void;
  savedStack: (value: unknown) => FileVisit[];
  previewTimer: ReturnType<typeof setTimeout> | undefined;
  previewQueue: ReturnType<typeof createPreviewQueue>;
  notice: ReturnType<typeof paneNotice>;
  linkedCompiles: Map<string, { sources: string; result: Promise<{ boards: ReturnType<typeof indexBoards>; render: RenderBoard; }>; }>;
  part: <T extends HTMLElement = HTMLElement>(name: string) => T;
  draftStatus: HTMLElement;
  missingBacklink: HTMLInputElement;
  boundaryPorts: HTMLInputElement;
  updateLint: () => void;
  setFormatStatus: (message: string, kind?: 'info' | 'error') => void;
}

export function setupPaneLifecycle(ctx: Context) {
  const pane = {
    id: ctx.id,
    root: ctx.root,
    scope: ctx.scope,
    viewer: ctx.viewer,
    editor: ctx.editor,
    viewport: ctx.viewport,
    showView: ctx.showView,
    views: ctx.views,
    setActivity: ctx.setActivity,
    get key() { return ctx.currentDocumentKey; },
    get name() { return ctx.documentName; },
    get source() { return ctx.editor.source; },
    get generation() { return ctx.generation; },
    /** Opening and closing documents invalidates outstanding file reads. */
    get documentOpens() { return ctx.documentOpens; },
    get documentExport() { return ctx.documentExport; },
    get sourceError() { return ctx.sourceError; },
    async revealMatch(entry: DiagramSearchEntry) {
      const request = ctx.documentOpens;
      const revision = ctx.documentRevision;
      if (ctx.mappedSource !== ctx.editor.source) await ctx.load(ctx.editor.source, ctx.documentName, true);
      if (request === ctx.documentOpens && revision === ctx.documentRevision && ctx.mappedSource === ctx.editor.source && !ctx.sourceError)
        await ctx.boardTools.revealSearchMatch(entry);
    },
    compileProjectFile: ctx.compileProjectFile,
    /** The preview reflects the current source, so exports and source selection are valid. */
    get current() { return ctx.mappedSource === ctx.editor.source; },
    replaceDocument: ctx.replaceDocument,
    adopt: ctx.adopt,
    /** A sibling's source may be imported directly or transitively, including by a failed compile. */
    refreshProject(projectId: string) {
      if (!ctx.currentDocumentKey || projectIdOf(ctx.currentDocumentKey) !== projectId) return;
      ctx.boardTools.refreshSearch();
      if (ctx.showsAtlas()) return;
      ctx.invalidateSource();
      clearTimeout(ctx.debounce);
      ctx.debounce = setTimeout(() => void ctx.load(ctx.editor.source, ctx.documentName, true), 350);
    },
    save: () => { if (ctx.showsAtlas()) ctx.setActivity(atlasReadOnly); else ctx.saveFileButton.click(); },
    openAtlasMap: ctx.openAtlasMap,
    /** Name the document for its exports and downloads; returns the name it was given. */
    rename(name: string) {
      const renamed = ctx.picker().rename(ctx.id, name);
      if (!renamed) return ctx.documentName;
      // The file on disk keeps its name, so the next save asks where to save under the new one.
      const linked = ctx.shared.fileHandles.delete(renamed.key);
      ctx.adopt(renamed);
      ctx.setActivity(`Renamed to ${renamed.name}.${linked ? ' Save asks where to save it.' : ''}`);
      return ctx.documentName;
    },
    /** Show a document restored on startup, keeping its board from the page URL. */
    open(document: { key: string; name: string; source: string }) {
      ctx.viewer.stage.classList.remove('zf-starter-preview');
      ++ctx.documentOpens;
      ctx.boardTools.resetSearch();
      ctx.ai?.documentSwitched();
      ctx.sourceError = false;
      ctx.documentName = document.name;
      ctx.currentDocumentKey = document.key;
      // A reload keeps the files the first pane came through, which its history entry recorded.
      ctx.setFileStack(ctx.id === 'a' && history.state?.zoomflowFile === document.key ? ctx.savedStack(history.state.zoomflowFiles) : []);
      delete ctx.root.dataset.empty;
      ctx.viewport.setDocument(document.key);
      ctx.editor.open(document.key, document.source);
      ctx.boardTools.refresh();
      ctx.picker().refresh();
      clearTimeout(ctx.debounce);
      void ctx.load(ctx.editor.source, ctx.documentName);
    },
    /** Leave the pane without a document, for example when its draft is removed. */
    close() {
      ctx.viewer.stage.classList.remove('zf-starter-preview');
      ++ctx.documentOpens;
      ctx.boardTools.resetSearch();
      ctx.sourceError = false;
      clearTimeout(ctx.debounce);
      clearTimeout(ctx.previewTimer);
      ctx.previewTimer = undefined;
      // Like opening another document: pending format and AI results no longer apply.
      ++ctx.documentRevision;
      ctx.ai?.cancel();
      ctx.ai?.sourceChanged();
      ++ctx.generation;
      ctx.previewQueue.invalidate();
      ctx.viewer.cancelPendingRender();
      ctx.viewer.setBusy(false);
      ctx.currentDocumentKey = undefined;
      ctx.setFileStack([]);
      ctx.documentName = '';
      ctx.documentExport = undefined;
      ctx.root.dataset.empty = 'true';
      ctx.root.querySelector('.pane-document-name')!.textContent = 'Choose a diagram';
      ctx.root.querySelector<HTMLElement>('.pane-document .draft-unsaved')!.hidden = true;
      if (ctx.notice.owned) ctx.notice.hide();
      ctx.shared.exportChanged();
    },
    /** Restart after an engine failure or a slow preview; `restart` also abandons queued work. */
    retry(restart: boolean) {
      if (!ctx.currentDocumentKey) return;
      if (restart) ctx.previewQueue.restart();
      // Linked files' boards render with the engine a restart disposes.
      if (restart) ctx.linkedCompiles.clear();
      clearTimeout(ctx.debounce);
      ctx.invalidateSource();
      void ctx.load(ctx.editor.source, ctx.documentName, true);
    },
    focusSource(range?: { from: number; to: number }) {
      ctx.showView('source');
      if (range) ctx.editor.select(range, true);
      else ctx.editor.view.focus();
    },
    renderDraftState({ dirty, recoveryAvailable, savePending, hasDraft, downloadRequested }: DraftState) {
      const atlas = ctx.showsAtlas();
      ctx.boardTools.refreshSearch();
      for (const name of ['save-file', 'format-source', 'clear-source']) ctx.part(name).hidden = atlas;
      const handle = ctx.currentDocumentKey ? ctx.shared.fileHandles.get(ctx.currentDocumentKey) : undefined;
      const canSave = Boolean(handle) || canChooseSaveFile();
      // Activating this pane on pointerdown refreshes its status; replacing the label cancels WebKit's click.
      setText(ctx.saveFileButton, canSave ? 'Save .d2' : 'Download .d2');
      ctx.saveFileButton.title = `${canSave ? 'Save source to a file' : 'Download a source copy; this browser cannot write back to your file'} (⌘S or Ctrl+S)`;
      const recovery = !recoveryAvailable ? 'Browser draft unavailable' : savePending ? 'Saving browser draft…' : 'Browser draft saved';
      const file = downloadRequested ? 'Source download started' : handle && !dirty ? 'Saved to file'
        : dirty ? 'File has unsaved changes' : hasDraft ? 'Save a file copy to keep' : 'Edit to update the preview';
      const status = atlas ? 'Atlas map · read-only, drawn from the project files' : recoveryAvailable ? file : `${file} · Browser draft unavailable`;
      // Do not repeatedly announce unchanged file state during background backups.
      if (ctx.draftStatus.textContent !== status) ctx.draftStatus.textContent = status;
      ctx.draftStatus.dataset.kind = recoveryAvailable ? 'info' : 'error';
      ctx.draftStatus.dataset.recovery = !recoveryAvailable ? 'unavailable' : savePending ? 'pending' : 'saved';
      ctx.draftStatus.title = `${recovery}. ${canSave ? 'Save keeps a source copy on disk.' : 'Download keeps a separate source copy.'} View settings stay in this browser. Browser storage can be cleared.`;
      ctx.part('recovery-info').textContent = recoveryAvailable
        ? 'Source edits and view settings are backed up in this browser. Save a disk copy of your source to keep it; view settings stay in this browser.'
        : 'Browser recovery is unavailable. Save or download your source to keep it; view settings may be lost on reload.';
      // Rewriting an unchanged label under the pointer cancels the click in WebKit.
      const label = ctx.root.querySelector('.pane-document-name')!;
      if (label.textContent !== ctx.documentName) label.textContent = ctx.documentName;
      ctx.root.querySelector<HTMLElement>('.pane-document .draft-unsaved')!.hidden = !dirty;
    },
    /** A closed split keeps the second pane for reopening; it releases page-level listeners meanwhile. */
    suspend: () => ctx.viewer.suspend(),
    resume: () => ctx.viewer.resume(),
    lintOptions: { missingBacklink: ctx.missingBacklink, boundaryPorts: ctx.boundaryPorts },
    updateLint: ctx.updateLint,
    dispose() {
      clearTimeout(ctx.debounce); clearTimeout(ctx.previewTimer); ctx.setActivity(''); ctx.setFormatStatus('');
      ctx.previewQueue.invalidate(); ctx.ai?.dispose(); ++ctx.generation; ctx.editor.destroy(); ctx.viewer.destroy();
    },
  };
  return { pane };
}
