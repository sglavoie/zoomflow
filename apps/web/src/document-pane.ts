import { indexShapeSources, parseSourceRange, lint, type CompileResponse, type ShapeSource, type Diagram, type LintDiagnostic, type LintResult } from '@zoomflow/core';
import { Viewer, setupViewport, type RenderBoard, type ViewerRoute } from '@zoomflow/viewer';
import { SourceEditor } from './editor';
import { compilerDiagnostics, lintDiagnostics, type SourceDiagnostic } from './diagnostics';
import { CompilerStartupError, type createCompiler } from './compiler';
import { createPreviewQueue } from './preview-queue';
import { setupFullscreen } from './fullscreen';
import { setupAiAssistant } from './ai-assistant';
import { setupMobileView } from './mobile-view';
import { projectFileSystem } from './project-files';
import { setupCanvasGuidance } from './canvas-guidance';
import type { setupFlowBuilder } from './flow-builder';
import type { DraftState, setupExamplePicker } from './example-picker';
import { paneScope, type PaneId } from './pane-scope';
import { describeError, plural } from './text';

export type { PaneId } from './pane-scope';
export type DocumentExport = { diagram: Diagram; render: RenderBoard; name: string; diagnostics: LintDiagnostic[] };
type PickerWindow = Window & { showSaveFilePicker?: (options?: object) => Promise<FileSystemFileHandle> };

/** What the panes share: one compiler, the draft library and the page-level controls. */
export type PaneContext = {
  compiler: ReturnType<typeof createCompiler>;
  picker: () => ReturnType<typeof setupExamplePicker>;
  flowBuilder: ReturnType<typeof setupFlowBuilder>;
  engine: { notice: HTMLElement; message: HTMLElement; retry: HTMLButtonElement };
  fileHandles: Map<string, FileSystemFileHandle>;
  documentRoutes: Map<string, ViewerRoute>;
  isActive: () => boolean;
  /** Whether this pane shows one view at a time (narrow screens and split tabs). */
  tabbed: () => boolean;
  exportChanged: () => void;
  setExportStatus: (message: string, kind?: 'info' | 'error') => void;
  clearFileError: () => void;
  /** Select a source location in the pane that shows it. */
  revealSource: (pane: PaneId, range?: { from: number; to: number }) => void;
  /** The lint options changed in this pane; other panes follow. */
  lintChanged: () => void;
};

/** A status message that announces errors as alerts and hides settled info after a few seconds. */
function statusLine(element: HTMLElement) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return (message: string, kind: 'info' | 'error' = 'info') => {
    clearTimeout(timer);
    element.textContent = message;
    element.title = message;
    element.dataset.kind = kind;
    element.setAttribute('role', kind === 'error' ? 'alert' : 'status');
    element.hidden = !message;
    if (message && kind === 'info' && !message.endsWith('…')) timer = setTimeout(() => { element.hidden = true; }, 4000);
  };
}

/** One document's editor, preview, diagnostics and status. The workspace shows one or two panes. */
export function createDocumentPane(id: PaneId, root: HTMLElement, shared: PaneContext) {
  const scope = paneScope(id, root);
  const { part } = scope;
  const picker = () => shared.picker();
  const pickerWindow = window as PickerWindow;
  const viewer = new Viewer(part('viewer'), { history: id === 'a', active: shared.isActive });
  const viewport = setupViewport(viewer.stage, setupFullscreen(viewer.stage, root));
  const mobileError = document.createElement('div');
  mobileError.id = scope.id('mobile-error');
  mobileError.className = 'mobile-error';
  mobileError.hidden = true;
  mobileError.innerHTML = '<span role="status"></span><button type="button">Go to error</button>';
  viewer.stage.parentElement!.before(mobileError);
  const mobileErrorText = mobileError.querySelector('span')!;
  const mobileErrorButton = mobileError.querySelector('button')!;
  const views = setupMobileView(root, part<HTMLButtonElement>('mobile-preview'), part<HTMLButtonElement>('mobile-source'),
    shared.tabbed, () => viewport.refresh());
  const showView = views.show;
  const { engine } = shared;

  let generation = 0;
  let documentRevision = 0;
  let ai: ReturnType<typeof setupAiAssistant> | undefined;
  let documentName = '';
  let currentDocumentKey: string | undefined;
  let sourceMap: ShapeSource[] = [];
  let mappedSource: string | undefined;
  let debounce: ReturnType<typeof setTimeout> | undefined;
  const errorBanner = part('compile-error');
  const lintSummary = part('lint-summary');
  const draftStatus = part('draft-status');
  const saveFileButton = part<HTMLButtonElement>('save-file');
  const previewStatus = part('preview-status');
  const missingBacklink = part<HTMLInputElement>('missing-backlink');
  const boundaryPorts = part<HTMLInputElement>('boundary-ports');
  const formatButton = part<HTMLButtonElement>('format-source');
  const formatStatus = part('format-status');
  const activityStatus = part('activity-status');
  const diagnosticsButton = part<HTMLButtonElement>('show-diagnostics');
  const revealButton = part<HTMLButtonElement>('reveal-source');
  const goToError = part<HTMLButtonElement>('go-to-error');
  const compileErrorMessage = part('compile-error-message');
  let activeDiagnostics: SourceDiagnostic[] = [];
  let previewTimer: ReturnType<typeof setTimeout> | undefined;
  const previewQueue = createPreviewQueue();
  let documentExport: DocumentExport | undefined;

  function setPreviewState(state: 'loading' | 'updating' | 'ready' | 'error' | 'unavailable') {
    if (state === 'updating') {
      if (previewTimer || previewStatus.dataset.state === 'updating') return;
      previewTimer = setTimeout(() => {
        previewTimer = undefined;
        previewStatus.dataset.state = 'updating';
        previewStatus.textContent = 'Updating preview…';
        lintSummary.textContent = 'Checking diagnostics…';
        viewer.stage.dataset.previewState = 'updating';
      }, 700);
      return;
    }
    clearTimeout(previewTimer);
    previewTimer = undefined;
    previewStatus.dataset.state = state;
    previewStatus.textContent = { loading: 'Loading preview…',
      ready: 'Preview ready', error: 'Preview out of date', unavailable: 'Preview unavailable' }[state];
    if (state === 'error') viewer.stage.dataset.previewState = 'stale';
    else delete viewer.stage.dataset.previewState;
    viewer.stage.dispatchEvent(new Event('zf-sourcechange'));
  }
  const setActivity = statusLine(activityStatus);
  const setFormatStatus = statusLine(formatStatus);
  function setEditorDiagnostics(diagnostics: SourceDiagnostic[]) {
    activeDiagnostics = diagnostics;
    const errors = diagnostics.filter((item) => item.severity === 'error').length;
    const warnings = diagnostics.length - errors;
    part('mobile-source').textContent = errors ? `Source · ${plural(errors, 'error')}`
      : warnings ? `Source · ${plural(warnings, 'warning')}` : 'Source';
    editor.diagnostics(diagnostics, picker().compilation(id).inputPath, documentName, canOpenDiagnostic, (item) => void openDiagnostic(item));
    diagnosticsButton.disabled = diagnostics.length === 0;
    diagnosticsButton.textContent = diagnostics.length ? `Diagnostics (${diagnostics.length})` : 'Diagnostics';
    diagnosticsButton.setAttribute('aria-label', `Review ${plural(diagnostics.length, 'diagnostic')}`);
  }
  let lintDocument: CompileResponse | undefined;
  /** Lint with default options, computed once per compile for the viewer and exports. */
  let defaultLint: LintResult | undefined;
  function invalidateSource() {
    flowEdit.refresh();
    // Invalidate immediately, including requests still awaiting WASM/render startup.
    ++generation;
    previewQueue.invalidate();
    ++documentRevision;
    ai?.sourceChanged();
    viewer.setBusy(true);
    setFormatStatus('');
    viewer.cancelPendingRender();
    sourceMap = [];
    revealButton.disabled = true;
    lintDocument = undefined;
    setEditorDiagnostics([]);
    mobileError.hidden = true;
    viewer.highlightShapes([]);
    documentExport = undefined;
    shared.exportChanged();
    setPreviewState('updating');
    setActivity('');
    shared.clearFileError();
    shared.setExportStatus('');
    goToError.disabled = true;
    viewer.stage.dispatchEvent(new Event('zf-sourcechange'));
  }
  const editor = new SourceEditor(part('editor'), {
    panelId: scope.id('diagnostics-panel'),
    changed: () => {
      invalidateSource();
      picker().updateCurrent(id, editor.source);
      clearTimeout(debounce);
      debounce = setTimeout(() => void load(editor.source, documentName, true), 350);
    },
    selected: () => void highlightSelection(false),
    format: () => void formatSource(),
    reveal: () => void revealSelection(),
  });
  const flowEdit = shared.flowBuilder.attach(scope, {
    read: () => ({ source: editor.source, name: documentName }),
    update: source => {
      editor.replaceSource(source);
      showView('preview');
    },
  });

  saveFileButton.addEventListener('click', async () => {
    if (!currentDocumentKey) return;
    saveFileButton.disabled = true;
    const key = currentDocumentKey;
    const source = editor.source;
    const name = documentName;
    let saving: ReturnType<typeof setTimeout> | undefined;
    try {
      let handle = shared.fileHandles.get(key);
      if (!handle && pickerWindow.showSaveFilePicker) {
        handle = await pickerWindow.showSaveFilePicker({ suggestedName: name,
          types: [{ description: 'D2 source', accept: { 'text/plain': ['.d2'] } }] });
      }
      if (!handle) {
        document.querySelector<HTMLButtonElement>('#save-source')!.click();
        return;
      }
      saving = setTimeout(() => { if (currentDocumentKey === key) setActivity('Saving file…'); }, 700);
      const writable = await handle.createWritable();
      try { await writable.write(source); await writable.close(); }
      catch (error) { await writable.abort(); throw error; }
      const saved = picker().markDiskSaved(key, source, handle.name);
      if (!saved) return; // The draft may have been removed while the file dialog was open.
      shared.fileHandles.set(saved.key, handle);
      if (currentDocumentKey === key) {
        if (saved.key !== key) {
          editor.copyDocument(saved.key);
          viewport.copyDocument(saved.key);
          const route = shared.documentRoutes.get(key);
          if (route) shared.documentRoutes.set(saved.key, route);
        }
        currentDocumentKey = saved.key;
        documentName = saved.name;
        // Save identity changes do not invalidate compiled geometry or editor history.
        picker().refresh();
        setActivity('');
      }
    } catch (error) {
      if (currentDocumentKey === key && !(error instanceof DOMException && error.name === 'AbortError')) setActivity(`Could not save file: ${describeError(error)}`, 'error');
    } finally {
      clearTimeout(saving);
      if (currentDocumentKey === key && activityStatus.textContent === 'Saving file…') setActivity('');
      saveFileButton.disabled = false;
    }
  });

  async function replaceDocument(source: string, name: string, key: string, reset = false) {
    viewer.setRoute(reset ? undefined : shared.documentRoutes.get(key));
    viewport.setDocument(key, reset);
    documentName = name;
    currentDocumentKey = key;
    delete root.dataset.empty;
    picker().refresh();
    editor.open(key, source, reset);
    invalidateSource();
    errorBanner.hidden = true;
    goToError.hidden = true;
    clearTimeout(debounce);
    await load(source, name);
  }

  async function compileSource(source: string) {
    const context = picker().compilation(id);
    const { d2, fonts } = await shared.compiler.get();
    const input = projectFileSystem(context.inputPath, context.fs, source);
    const padValue = new URLSearchParams(location.search).get('pad');
    const pad = padValue === null ? 100 : Number(padValue);
    return d2.compile(input, {
      ...fonts,
      layout: 'elk', themeID: 0, darkThemeID: 200,
      pad: Number.isFinite(pad) && pad >= 0 ? pad : 100,
    });
  }

  async function formatSource() {
    if (formatButton.disabled) return;
    const revision = documentRevision;
    const document = editor.view.state.doc;
    const source = editor.source;
    formatButton.disabled = true;
    setFormatStatus('Formatting…');
    try {
      const compiled = mappedSource === source && lintDocument ? lintDocument : await compileSource(source);
      // Edits or opening another file invalidate this request, even after undo.
      if (editor.view.state.doc !== document || documentRevision !== revision) return;
      const formatted = compiled.fs[compiled.inputPath];
      if (typeof formatted !== 'string') throw new Error('D2 did not return formatted source.');
      setFormatStatus(editor.format(formatted) ? 'Source formatted.' : 'Source is already formatted.');
    } catch (error) {
      if (editor.view.state.doc !== document || documentRevision !== revision) return;
      setFormatStatus(`Formatting failed: ${compilerDiagnostics(error, source, picker().compilation(id).inputPath).map((item) => item.message).join('\n')}`, 'error');
    } finally { formatButton.disabled = false; }
  }
  formatButton.addEventListener('click', () => void formatSource());
  part('clear-source').addEventListener('click', () => {
    if (editor.replaceSource('', 'delete.clear')) setActivity('Source cleared. Undo with ⌘Z / Ctrl+Z.');
    editor.view.focus();
  });
  ai = setupAiAssistant(scope, {
    read: () => ({ source: editor.source, name: documentName, board: viewer.currentBoard?.id ?? 'root', revision: documentRevision }),
    validate: async (source) => { await compileSource(source); },
    apply: (source) => editor.applyAi(source),
    onStatus: (message, kind) => setActivity(message, kind),
    undo: () => editor.undo(),
    revealChange: () => { showView('source'); editor.revealAiChange(); },
    dismissHighlights: () => editor.clearAiHighlights(),
  });

  function updateLint() {
    if (!lintDocument || mappedSource !== editor.source) return;
    const result = !missingBacklink.checked && !boundaryPorts.checked && defaultLint ? defaultLint
      : lint(lintDocument, { missingBacklink: missingBacklink.checked, boundaryPorts: boundaryPorts.checked });
    setEditorDiagnostics(lintDiagnostics(result.diagnostics, editor.source, sourceMap, lintDocument.inputPath));
    const errors = result.diagnostics.filter((item) => item.severity === 'error').length;
    const warnings = result.diagnostics.length - errors;
    lintSummary.textContent = errors || warnings ? `${plural(errors, 'lint error')}, ${plural(warnings, 'warning')}` : 'No lint issues';
    lintSummary.dataset.empty = String(!errors && !warnings);
  }
  for (const option of [missingBacklink, boundaryPorts]) option.addEventListener('change', () => { updateLint(); shared.lintChanged(); });
  function canOpenDiagnostic(item: SourceDiagnostic) {
    const context = picker().compilation(id);
    if (item.filename === context.inputPath) return Boolean(item.range);
    const text = item.filename && context.fs[item.filename];
    return typeof text === 'string' && Boolean(item.rawRange && parseSourceRange(item.rawRange, text, item.filename));
  }
  async function openDiagnostic(item: SourceDiagnostic) {
    if (!canOpenDiagnostic(item)) return;
    showView('source');
    if (item.filename === picker().compilation(id).inputPath) {
      if (item.range) editor.select(item.range, true);
      return;
    }
    const target = picker().selectProjectPath(id, item.filename!);
    if (!target || !item.rawRange) return;
    const range = parseSourceRange(item.rawRange, target.source, item.filename);
    // The other pane already shows that file: select the location there.
    if (target.pane !== id) { shared.revealSource(target.pane, range); return; }
    const key = target.key;
    await replaceDocument(target.source, target.name, key);
    // A second navigation during compilation must not move the new document's cursor.
    if (currentDocumentKey !== key || editor.source !== target.source) return;
    if (range) editor.select(range, true);
  }
  diagnosticsButton.addEventListener('click', () => {
    showView('source');
    editor.showDiagnostics();
  });
  mobileErrorButton.addEventListener('click', () => goToError.click());
  goToError.addEventListener('click', () => {
    if (activeDiagnostics[0]) void openDiagnostic(activeDiagnostics[0]);
  });

  async function highlightSelection(navigate: boolean) {
    if (mappedSource !== editor.source) return;
    const { from, to, empty } = editor.selection;
    const matches = sourceMap.filter((entry) => empty
      ? from >= entry.from && from < entry.to : from < entry.to && to > entry.from);
    const current = viewer.currentBoard?.id;
    const target = matches.find((entry) => entry.board === current) ?? matches[0];
    revealButton.disabled = !target;
    if (navigate && target && target.board !== current) await viewer.navigate(target.board);
    viewer.highlightShapes(matches.filter((entry) => entry.board === viewer.currentBoard?.id).map((entry) => entry.shape));
  }
  async function revealSelection() {
    if (revealButton.disabled) return;
    const revision = documentRevision;
    await highlightSelection(true);
    if (revision !== documentRevision) return;
    showView('preview');
    viewport.reveal([...viewer.stage.querySelectorAll<SVGGraphicsElement>('.zf-source-selected')]);
    viewer.stage.focus({ preventScroll: true });
  }
  revealButton.addEventListener('click', () => void revealSelection());
  viewer.stage.addEventListener('zf-boardchange', () => {
    // Viewer commits its URL and trail immediately after dispatching this event.
    queueMicrotask(() => {
      if (currentDocumentKey) shared.documentRoutes.set(currentDocumentKey, viewer.route);
      shared.exportChanged();
    });
    void highlightSelection(false);
  });
  function selectShape(event: MouseEvent | KeyboardEvent) {
    if (mappedSource !== editor.source) return;
    const shape = event.target instanceof Element ? event.target.closest<SVGElement>('[data-shape-id]')
      ?? event.target.closest('a')?.querySelector<SVGElement>('[data-shape-id]') : null;
    const entry = shape && sourceMap.find((item) => item.board === viewer.currentBoard?.id && item.shape === shape.dataset.shapeId);
    if (!entry) return;
    const linked = Boolean(shape.closest('a'));
    if (event instanceof KeyboardEvent) {
      if (event.key !== 'Enter' && event.key !== ' ' || linked && !event.altKey) return;
      event.preventDefault();
      event.stopImmediatePropagation();
    }
    if (linked && event.altKey) { event.preventDefault(); event.stopImmediatePropagation(); }
    if (!linked || event.altKey) showView('source');
    editor.select(entry, !linked || event.altKey);
    void highlightSelection(false);
  }
  viewer.stage.addEventListener('click', selectShape, { capture: true });
  viewer.stage.addEventListener('keydown', selectShape, { capture: true });
  setupCanvasGuidance(viewer.stage, viewport.setGuidance, () => sourceMap.length > 0 && mappedSource === editor.source,
    () => {
      if (root.hasAttribute('data-fullscreen')) root.querySelector<HTMLButtonElement>('.zf-fullscreen-toggle')!.click();
      showView('source'); editor.view.focus();
    });

  function load(source: string, name: string, preserveViewport = false) {
    return previewQueue.run(() => loadPreview(source, name, preserveViewport));
  }
  let previewAttempt: symbol;
  async function loadPreview(source: string, name: string, preserveViewport: boolean) {
    const attempt = previewAttempt = Symbol();
    let slowTimer: ReturnType<typeof setTimeout> | undefined;
    const request = ++generation;
    viewer.setBusy(true);
    viewer.setMessage('');
    setPreviewState(viewer.stage.querySelector('svg') ? 'updating' : 'loading');
    engine.notice.hidden = true;
    engine.retry.hidden = true;
    engine.retry.dataset.restart = 'false';
    engine.retry.textContent = 'Retry preview';
    const startupTimer = !shared.compiler.ready ? setTimeout(() => {
      if (request !== generation) return;
      engine.notice.setAttribute('role', 'status');
      engine.message.textContent = 'Loading the diagram engine… The first download can take a moment. You can keep editing.';
      engine.notice.hidden = false;
    }, 1200) : undefined;
    try {
      const { d2 } = await shared.compiler.get();
      clearTimeout(startupTimer);
      if (request !== generation) return;
      engine.notice.hidden = true;
      slowTimer = setTimeout(() => {
        if (attempt !== previewAttempt) return;
        engine.notice.setAttribute('role', 'status');
        engine.message.textContent = 'The preview is taking longer than usual. You can keep editing, wait, or restart the engine to preview your latest source.';
        engine.notice.hidden = false;
        engine.retry.textContent = 'Restart preview';
        engine.retry.dataset.restart = 'true';
        engine.retry.hidden = false;
      }, 15_000);
      const compiled = await compileSource(source);
      if (request !== generation) return;
      // D2 registers fonts at compile time for both text measurement and rendering.
      // This diagram carries that family into every viewer/export render call.
      const render: RenderBoard = (target) => d2.render(compiled.diagram, {
        ...compiled.renderOptions, target, noXMLTag: true,
      });
      const linted = lint(compiled);
      const { diagnostics } = linted;
      const compiledSources = indexShapeSources(compiled.diagram, compiled.graph, source, compiled.inputPath);
      viewer.setSourceShapes(compiledSources);
      await viewer.setDocument(compiled.diagram, render, diagnostics, preserveViewport);
      if (request === generation) {
        sourceMap = compiledSources;
        mappedSource = source;
        lintDocument = compiled;
        defaultLint = linted;
        updateLint();
        errorBanner.hidden = true;
        goToError.hidden = true;
        compileErrorMessage.textContent = '';
        void highlightSelection(false);
        documentExport = { diagram: compiled.diagram, render, name, diagnostics };
        shared.exportChanged();
        mobileError.hidden = true;
        setPreviewState('ready');
      }
    } catch (error) {
      if (request === generation) {
        if (error instanceof CompilerStartupError) {
          setEditorDiagnostics([]);
          errorBanner.hidden = true;
          goToError.hidden = true;
          mobileError.hidden = true;
          lintSummary.textContent = '';
          engine.notice.setAttribute('role', 'alert');
          engine.message.textContent = 'The diagram engine could not start. Check your connection and retry. Your source is preserved.';
          engine.notice.hidden = false;
          engine.retry.hidden = false;
          setPreviewState('unavailable');
          return;
        }
        const diagnostics = compilerDiagnostics(error, source, picker().compilation(id).inputPath);
        setEditorDiagnostics(diagnostics);
        lintDocument = undefined;
        lintSummary.textContent = plural(diagnostics.length, 'source error');
        const first = diagnostics[0];
        const filename = picker().compilation(id).inputPath;
        const externalCompilerError = first.filename && first.filename !== filename ? first : undefined;
        const message = first.message.replace(/^[^:]+:\d+:\d+:\s*/, '');
        compileErrorMessage.textContent = externalCompilerError
          ? `Error · ${first.message}` : first.range ? `Error · Line ${first.line}, column ${first.column}: ${message}` : `Error · Source location unavailable: ${message}`;
        goToError.textContent = externalCompilerError ? `Open ${externalCompilerError.filename}` : 'Go to error';
        goToError.title = goToError.textContent;
        goToError.hidden = false;
        goToError.disabled = !canOpenDiagnostic(first);
        errorBanner.title = compileErrorMessage.textContent!;
        mobileErrorText.textContent = errorBanner.title;
        mobileErrorButton.textContent = goToError.textContent;
        mobileErrorButton.disabled = goToError.disabled;
        mobileError.hidden = false;
        errorBanner.hidden = false;
        viewer.setMessage('');
        setPreviewState('error');
      }
    } finally {
      clearTimeout(startupTimer);
      clearTimeout(slowTimer);
      if (attempt === previewAttempt && engine.retry.dataset.restart === 'true') {
        engine.notice.hidden = true;
        engine.retry.hidden = true;
        engine.retry.dataset.restart = 'false';
      }
      if (request === generation) viewer.setBusy(false);
    }
  }

  const pane = {
    id,
    root,
    scope,
    viewer,
    editor,
    viewport,
    showView,
    views,
    setActivity,
    get key() { return currentDocumentKey; },
    get name() { return documentName; },
    get source() { return editor.source; },
    get generation() { return generation; },
    get documentExport() { return documentExport; },
    /** The preview reflects the current source, so exports and source selection are valid. */
    get current() { return mappedSource === editor.source; },
    replaceDocument,
    save: () => saveFileButton.click(),
    /** Show a document restored on startup, keeping its board from the page URL. */
    open(document: { key: string; name: string; source: string }) {
      documentName = document.name;
      currentDocumentKey = document.key;
      delete root.dataset.empty;
      viewport.setDocument(document.key);
      editor.open(document.key, document.source);
      flowEdit.refresh();
      picker().refresh();
      clearTimeout(debounce);
      void load(editor.source, documentName);
    },
    /** Leave the pane without a document, for example when its draft is removed. */
    close() {
      clearTimeout(debounce);
      ++generation;
      previewQueue.invalidate();
      viewer.cancelPendingRender();
      currentDocumentKey = undefined;
      documentName = '';
      documentExport = undefined;
      root.dataset.empty = 'true';
      root.querySelector('.pane-document-name')!.textContent = 'Choose a diagram';
      root.querySelector<HTMLElement>('.pane-document .draft-unsaved')!.hidden = true;
      shared.exportChanged();
    },
    /** Restart after an engine failure or a slow preview; `restart` also abandons queued work. */
    retry(restart: boolean) {
      if (!currentDocumentKey) return;
      if (restart) previewQueue.restart();
      clearTimeout(debounce);
      invalidateSource();
      void load(editor.source, documentName, true);
    },
    focusSource(range?: { from: number; to: number }) {
      showView('source');
      if (range) editor.select(range, true);
      else editor.view.focus();
    },
    renderDraftState({ dirty, recoveryAvailable, savePending, hasDraft, downloadRequested }: DraftState) {
      const handle = currentDocumentKey ? shared.fileHandles.get(currentDocumentKey) : undefined;
      const canSave = Boolean(handle || pickerWindow.showSaveFilePicker);
      saveFileButton.textContent = canSave ? 'Save .d2' : 'Download .d2';
      saveFileButton.title = `${canSave ? 'Save source to a file' : 'Download a source copy; this browser cannot write back to your file'} (⌘S or Ctrl+S)`;
      const recovery = !recoveryAvailable ? 'Browser draft unavailable' : savePending ? 'Saving browser draft…' : 'Browser draft saved';
      const file = downloadRequested ? 'Source download started' : handle && !dirty ? 'Saved to file'
        : dirty ? 'File has unsaved changes' : hasDraft ? 'Save a file copy to keep' : 'Edit to update the preview';
      const status = recoveryAvailable ? file : `${file} · Browser draft unavailable`;
      // Do not repeatedly announce unchanged file state during background backups.
      if (draftStatus.textContent !== status) draftStatus.textContent = status;
      draftStatus.dataset.kind = recoveryAvailable ? 'info' : 'error';
      draftStatus.dataset.recovery = !recoveryAvailable ? 'unavailable' : savePending ? 'pending' : 'saved';
      draftStatus.title = `${recovery}. ${canSave ? 'Save keeps a copy on disk.' : 'Download keeps a separate file copy.'} Browser drafts can be cleared.`;
      part('recovery-info').textContent = recoveryAvailable
        ? 'Edits are backed up in this browser. Save a disk copy to keep them; browser storage can be cleared.'
        : 'Browser recovery is unavailable. Save or download a disk copy to keep your edits.';
      // Rewriting an unchanged label under the pointer cancels the click in WebKit.
      const label = root.querySelector('.pane-document-name')!;
      if (label.textContent !== documentName) label.textContent = documentName;
      root.querySelector<HTMLElement>('.pane-document .draft-unsaved')!.hidden = !dirty;
    },
    lintOptions: { missingBacklink, boundaryPorts },
    updateLint,
    dispose() {
      clearTimeout(debounce); clearTimeout(previewTimer); setActivity(''); setFormatStatus('');
      previewQueue.invalidate(); ai?.dispose(); ++generation; editor.destroy(); viewer.destroy();
    },
  };
  return pane;
}
export type DocumentPane = ReturnType<typeof createDocumentPane>;
