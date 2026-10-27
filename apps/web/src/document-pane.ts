import { boardBlocks, classifyHref, indexBoards, indexShapeSources, parseSourceRange, lint, resolveFilePath, type CompileResponse, type ShapeSource, type SourceRange, type Diagram, type LintDiagnostic, type LintResult } from '@zoomflow/core';
import { Viewer, openFolderMessage, setupViewport, type RenderBoard, type ViewerRoute } from '@zoomflow/viewer';
import { SourceEditor } from './editor';
import { compilerDiagnostics, lintDiagnostics, type SourceDiagnostic } from './diagnostics';
import { CompilerStartupError, isEngineUnavailable, type createCompiler } from './compiler';
import { AiError } from './ai-errors';
import { createPreviewQueue } from './preview-queue';
import { setupFullscreen } from './fullscreen';
import { setupAiAssistant } from './ai-assistant';
import { setupMobileView } from './mobile-view';
import { newProjectPath, projectFileSystem } from './project-files';
import { setupCanvasGuidance } from './canvas-guidance';
import { setupBoardTools } from './board-tools';
import { boardRoute, setupLinkPreview } from './link-preview';
import { boardSites } from './board-model';
import { createProjectFile, type DirectoryHandles, type FileHandles } from './file-handles';
import type { setupFlowBuilder } from './flow-builder';
import type { setupMindMapBuilder } from './mind-map-builder';
import type { DraftState, setupExamplePicker } from './example-picker';
import { paneScope, type PaneId } from './pane-scope';
import { paneNotice, type EngineNotice } from './engine-notice';
import { setupCompileError } from './compile-error';
import { canChooseSaveFile, setupSaveFile } from './save-file';
import { describeError, plural, setText } from './text';

export type { PaneId } from './pane-scope';
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
  /** Select a source location in the pane that shows it. */
  revealSource: (pane: PaneId, range?: { from: number; to: number }) => void;
  /** The lint options changed in this pane; other panes follow. */
  lintChanged: () => void;
};

/** A visible status line announced through polite and assertive live regions that keep their roles.
 * Settled info hides after a few seconds. */
function statusLine(element: HTMLElement) {
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

/** A file a pane came through on the way to the one it shows, and the board it was left on. */
type FileVisit = { key: string; path: string; route: ViewerRoute };
/** Board hashes of each project file's last compile, by draft key, for checking links into that file. */
const compiledBoards = new Map<string, ReadonlySet<string>>();
/** The draft key of another file in the project of `key`, a `project:<id>:<path>` key. */
const siblingKey = (key: string, path: string) => `project:${key.split(':')[1]}:${path}`;
const projectLabel = (path: string) => path.replace(/\.d2$/i, '');
/** One document's editor, preview, diagnostics and status. The workspace shows one or two panes. */
export function createDocumentPane(id: PaneId, root: HTMLElement, shared: PaneContext) {
  const scope = paneScope(id, root);
  const { part } = scope;
  const picker = () => shared.picker();
  /** The project files of this pane's document, by project path; undefined outside a folder project. */
  function projectSources() {
    return picker().projectName(id) === undefined ? undefined : picker().compilation(id);
  }
  /** The project path a file link of this document opens, when it stays inside the project. */
  const linkedPath = (path: string) => projectSources() && resolveFilePath(picker().inputPath(id), path);
  const fileLabel = (path: string) => projectLabel(linkedPath(path) ?? path.replace(/^.*\//, ''));
  const fileLinks = {
    exists: (path: string) => {
      const target = linkedPath(path);
      return target !== undefined && Object.hasOwn(projectSources()!.fs, target);
    },
    open: (path: string, hash: string) => openFileLink(path, hash),
    label: fileLabel,
  };
  const viewer = new Viewer(part('viewer'), { history: id === 'a', active: shared.isActive,
    // Steps and topics open their board from the arrow badge, so a click on the shape selects it to edit.
    follows: (link, event) => (link as SVGElement).dataset.follow !== 'badge' || event instanceof KeyboardEvent ||
      Boolean(event.target instanceof Element && event.target.closest('.appendix-icon')),
    // Only folder projects can follow links to their other files; single files and drafts ask for the folder.
    get files() { return projectSources() && fileLinks; },
    onTopLevelBack: () => {
      if (!fileStack.length) return false;
      void returnToFile(fileStack.length - 1);
      return true;
    },
    document: { key: () => currentDocumentKey, restore: restoreFromHistory },
  });
  const viewport = setupViewport(viewer.stage, setupFullscreen(viewer.stage, root));
  const compileError = setupCompileError(scope, viewer.stage, () => {
    if (activeDiagnostics[0]) void openDiagnostic(activeDiagnostics[0]);
  });
  const views = setupMobileView(root, part<HTMLButtonElement>('mobile-preview'), part<HTMLButtonElement>('mobile-source'),
    shared.tabbed, () => viewport.refresh());
  const showView = views.show;
  const notice = paneNotice(shared.engine, id);

  let generation = 0;
  let documentRevision = 0;
  let ai: ReturnType<typeof setupAiAssistant> | undefined;
  let documentName = '';
  let currentDocumentKey: string | undefined;
  let sourceMap: ShapeSource[] = [];
  /** Where each board's block is in the compiled source. */
  let blocks = new Map<string, SourceRange>();
  let mappedSource: string | undefined;
  let debounce: ReturnType<typeof setTimeout> | undefined;
  /** The next change comes from the diagram or a builder, so it previews without waiting for more typing. */
  let immediate = false;
  /** A click on the background cleared the diagram's selection; it stays clear until the source selection changes. */
  let selectionCleared: { from: number; to: number } | undefined;
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
  let activeDiagnostics: SourceDiagnostic[] = [];
  let previewTimer: ReturnType<typeof setTimeout> | undefined;
  const previewQueue = createPreviewQueue();
  let documentExport: DocumentExport | undefined;
  /** The latest compile of this document failed with source errors. */
  let sourceError = false;
  /** The files this pane followed links through to reach its document, oldest first. */
  let fileStack: FileVisit[] = [];

  function setPreviewState(state: 'loading' | 'updating' | 'ready' | 'error' | 'unavailable') {
    if (state === 'updating') {
      if (previewTimer || previewStatus.dataset.state === 'updating') return;
      previewTimer = setTimeout(() => {
        previewTimer = undefined;
        previewStatus.dataset.state = 'updating';
        setText(previewStatus, 'Updating preview…');
        setText(lintSummary, 'Checking diagnostics…');
        viewer.stage.dataset.previewState = 'updating';
      }, 700);
      return;
    }
    clearTimeout(previewTimer);
    previewTimer = undefined;
    previewStatus.dataset.state = state;
    setText(previewStatus, { loading: 'Loading preview…',
      ready: 'Preview ready', error: 'Preview out of date', unavailable: 'Preview unavailable' }[state]);
    if (state === 'error') viewer.stage.dataset.previewState = 'stale';
    else delete viewer.stage.dataset.previewState;
    viewer.stage.dispatchEvent(new Event('zf-sourcechange'));
  }
  const setActivity = statusLine(activityStatus);
  const setFormatStatus = statusLine(formatStatus);
  function setEditorDiagnostics(diagnostics: SourceDiagnostic[]) {
    // Edits clear diagnostics on every keystroke; skip the work when there are none.
    if (!diagnostics.length && !activeDiagnostics.length) return;
    activeDiagnostics = diagnostics;
    const errors = diagnostics.filter((item) => item.severity === 'error').length;
    const warnings = diagnostics.length - errors;
    part('mobile-source').textContent = errors ? `Source · ${plural(errors, 'error')}`
      : warnings ? `Source · ${plural(warnings, 'warning')}` : 'Source';
    editor.diagnostics(diagnostics, picker().inputPath(id), documentName, canOpenDiagnostic, (item) => void openDiagnostic(item));
    diagnosticsButton.disabled = diagnostics.length === 0;
    diagnosticsButton.textContent = diagnostics.length ? `Diagnostics (${diagnostics.length})` : 'Diagnostics';
    diagnosticsButton.setAttribute('aria-label', `Review ${plural(diagnostics.length, 'diagnostic')}`);
  }
  let lintDocument: CompileResponse | undefined;
  /** Lint with default options, computed once per compile for the viewer and exports. */
  let defaultLint: LintResult | undefined;
  function invalidateSource() {
    boardTools.invalidate();
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
    viewer.highlightShapes([]);
    documentExport = undefined;
    shared.exportChanged();
    setPreviewState('updating');
    setActivity('');
    shared.clearFileError();
    shared.setExportStatus('');
    compileError.invalidate();
    viewer.stage.dispatchEvent(new Event('zf-sourcechange'));
  }
  const editor = new SourceEditor(part('editor'), {
    panelId: scope.id('diagnostics-panel'),
    changed: () => {
      invalidateSource();
      picker().updateCurrent(id, editor.source);
      clearTimeout(debounce);
      debounce = setTimeout(() => void load(editor.source, documentName, true), immediate ? 0 : 350);
      immediate = false;
    },
    selected: () => { selectionCleared = undefined; void highlightSelection(false); },
    format: () => void formatSource(),
    reveal: () => void revealSelection(),
    label: id === 'a' ? 'D2 source' : 'D2 source, second diagram',
  });
  const boardTools = setupBoardTools(scope, viewer, {
    builders: { flow: shared.flowBuilder, 'mind map': shared.mindMapBuilder },
    source: () => editor.source,
    update: (source) => {
      immediate = true;
      editor.replaceSource(source);
      immediate = false;
      showView('preview');
    },
    inSource: (shape) => sourceMap.some((item) => item.board === viewer.currentBoard?.id && item.shape === shape),
    selectSource: (shape, focusEditor) => {
      const entry = sourceMap.find((item) => item.board === viewer.currentBoard?.id && item.shape === shape);
      if (!entry || mappedSource !== editor.source) return;
      selectionCleared = undefined;
      if (focusEditor) showView('source');
      editor.select(entry, focusEditor);
      void highlightSelection(false);
    },
    status: (message, kind) => setActivity(message, kind),
    undo: () => { immediate = true; editor.undo(); immediate = false; },
    redo: () => { immediate = true; editor.redo(); immediate = false; },
    files: () => {
      const context = projectSources();
      if (!context) return;
      return {
        path: context.inputPath,
        files: Object.keys(context.fs).filter((path) => path !== context.inputPath).sort((a, b) => a.localeCompare(b)),
        boards: linkedBoards,
        open: (link) => {
          const href = classifyHref(link);
          if (href.kind === 'file') openFileLink(href.path, href.hash);
        },
        create: createLinkedFile,
      };
    },
  });
  /** The boards below a project file's root, named from the root down, for choosing where a link opens. */
  async function linkedBoards(path: string) {
    const { boards } = await compileLinkedFile(path);
    const names = (id: string): string[] => {
      const board = boards.get(id)!;
      return board.parent ? [...names(board.parent), board.kind === 'layers' ? board.name : `${board.name} (${board.kind === 'scenarios' ? 'scenario' : 'step'})`] : [];
    };
    return [...boards.values()].filter((board) => board.parent).map((board) => ({ hash: board.hash, label: names(board.id).join(' › ') }));
  }
  /** Create a project file beside this one, in the project's folder when the browser can write it, otherwise as a
   * draft that Save asks where to put. Resolves its project path. */
  async function createLinkedFile(name: string, source: string) {
    const context = projectSources();
    const projectId = currentDocumentKey?.split(':')[1];
    if (!context || !projectId) return;
    const taken = new Set(Object.keys(context.fs));
    const folder = shared.directoryHandles.get(projectId);
    try {
      for (;;) {
        const path = newProjectPath(context.inputPath, name, taken);
        const created = folder ? await createProjectFile(folder, path, source) : 'refused';
        if (created === 'exists') { taken.add(path); continue; }
        const key = picker().addProjectFile(id, path, source, created !== 'refused');
        if (!key) return;
        if (created !== 'refused') shared.fileHandles.set(key, created);
        else if (folder) setActivity(`Created ${path} as a draft. Save it to keep it.`);
        return path;
      }
    } catch (error) {
      setActivity(`Could not create a linked diagram: ${describeError(error)}`, 'error');
    }
  }
  const linkPreview = setupLinkPreview(scope, viewer, {
    label: fileLabel,
    missing: (path) => !projectSources() ? openFolderMessage : fileLinks.exists(path) ? undefined : `Missing file: ${fileLabel(path)}`,
    compile: (path) => compileLinkedFile(linkedPath(path)!),
  });
  /** One compile per linked file and source, for previews of the boards links open. */
  const linkedCompiles = new Map<string, { source: string; result: Promise<{ boards: ReturnType<typeof indexBoards>; render: RenderBoard }> }>();
  function compileLinkedFile(path: string) {
    const context = projectSources()!;
    const source = context.fs[path]!;
    const cached = linkedCompiles.get(path);
    if (cached?.source === source) return cached.result;
    const key = siblingKey(currentDocumentKey!, path);
    const result = (async () => {
      const { d2 } = await shared.compiler.get();
      const compiled = await compileSource(source, { inputPath: path, fs: context.fs });
      const boards = indexBoards(compiled.diagram);
      compiledBoards.set(key, new Set([...boards.values()].map((board) => board.hash)));
      const render: RenderBoard = (target) => d2.render(compiled.diagram, { ...compiled.renderOptions, target, noXMLTag: true });
      return { boards, render };
    })();
    linkedCompiles.set(path, { source, result });
    void result.catch(() => { if (linkedCompiles.get(path)?.result === result) linkedCompiles.delete(path); });
    return result;
  }

  function setFileStack(stack: FileVisit[]) {
    fileStack = stack;
    viewer.setTrailPrefix(stack.map((visit, index) => ({ name: projectLabel(visit.path), activate: () => void returnToFile(index) })));
  }
  /** Open another file of the project in this pane at `route`, coming from the files in `stack`.
   * The first pane records it as a history entry, so Back returns to the file before. */
  async function visitFile(target: { source: string; name: string; key: string }, route: ViewerRoute, stack: FileVisit[]) {
    if (id === 'a') history.pushState({ zoomflowFile: target.key, zoomflowFiles: stack, zoomflowTrail: route.trail }, '',
      `${location.pathname}${location.search}${route.hash}`);
    await replaceDocument(target.source, target.name, target.key, false, route, stack);
  }
  function openFileLink(path: string, hash: string) {
    const resolved = linkedPath(path);
    // Before the picker switches this pane to the target.
    const here: FileVisit = { key: currentDocumentKey!, path: picker().inputPath(id), route: viewer.route };
    const target = resolved && picker().selectProjectPath(id, resolved);
    if (!target) { viewer.setMessage(`Missing file: ${fileLabel(path)}`, true); return; }
    if (target.pane !== id) { viewer.setMessage(`${target.name} is open in the other pane.`, true); return; }
    // Coming back to a file on the way here shortens the way instead of repeating it.
    const earlier = fileStack.findIndex((visit) => visit.key === target.key);
    const stack = target.key === currentDocumentKey ? fileStack : earlier >= 0 ? fileStack.slice(0, earlier) : [...fileStack, here];
    void visitFile(target, { hash: boardRoute(hash) }, stack);
  }
  /** Reopen a file on the way here at the board it was left on. */
  async function returnToFile(index: number) {
    const visit = fileStack[index];
    const target = visit && picker().selectProjectPath(id, visit.path);
    if (!target || target.pane !== id) {
      viewer.setMessage(target ? `${target.name} is open in the other pane.` : `Missing file: ${projectLabel(visit.path)}`, true);
      return;
    }
    await visitFile(target, visit.route, fileStack.slice(0, index));
  }
  /** Files on the way here as a history entry recorded them, keeping those the project still has. */
  function savedStack(value: unknown): FileVisit[] {
    if (!Array.isArray(value)) return [];
    return value.filter((visit): visit is FileVisit => typeof visit?.key === 'string' && typeof visit.path === 'string' &&
      typeof visit.route?.hash === 'string' && picker().hasDraft(visit.key));
  }
  /** Back or Forward reached an entry of another file: open it when it belongs to this pane's project. */
  function restoreFromHistory(state: { zoomflowFile: string } & Record<string, unknown>) {
    const key = state.zoomflowFile;
    if (!key.startsWith('project:') || !currentDocumentKey?.startsWith('project:') ||
      siblingKey(currentDocumentKey, '') !== siblingKey(key, '')) return false;
    const target = picker().selectProjectPath(id, key.split(':').slice(2).join(':'));
    if (!target || target.pane !== id) return false;
    void replaceDocument(target.source, target.name, target.key, false, viewer.route, savedStack(state.zoomflowFiles));
    return true;
  }
  /** Dim the source outside the board on view; `opened` scrolls to it unless someone is typing there. */
  function showBoardSource(opened: boolean) {
    if (mappedSource !== editor.source) return;
    const board = viewer.currentBoard?.id ?? 'root';
    editor.showBoard(board === 'root' ? undefined : blocks.get(board), opened && !editor.view.hasFocus);
  }

  /** Take on a saved or renamed draft's key and name, which a saved or renamed example changes. */
  function adopt(saved: { key: string; name: string }) {
    if (saved.key !== currentDocumentKey) {
      editor.copyDocument(saved.key);
      viewport.copyDocument(saved.key);
      const route = shared.documentRoutes.get(currentDocumentKey!);
      if (route) shared.documentRoutes.set(saved.key, route);
    }
    currentDocumentKey = saved.key;
    documentName = saved.name;
    // Identity changes do not invalidate compiled geometry or editor history.
    picker().refresh();
  }
  setupSaveFile(saveFileButton, {
    fileHandles: shared.fileHandles, picker,
    key: () => currentDocumentKey, name: () => documentName, source: () => editor.source,
    adopt: (saved) => { adopt(saved); setActivity(''); },
    setActivity, activity: () => activityStatus.textContent,
  });

  /** Show a document; `route` overrides its remembered board. Without `stack`, it starts a new way through files. */
  async function replaceDocument(source: string, name: string, key: string, reset = false, route?: ViewerRoute, stack: FileVisit[] = []) {
    ai?.documentSwitched();
    sourceError = false;
    viewer.setRoute(reset ? undefined : route ?? shared.documentRoutes.get(key));
    viewport.setDocument(key, reset);
    documentName = name;
    currentDocumentKey = key;
    setFileStack(stack);
    delete root.dataset.empty;
    picker().refresh();
    editor.open(key, source, reset);
    invalidateSource();
    compileError.hide();
    clearTimeout(debounce);
    await load(source, name);
  }

  async function compileSource(source: string, context: { inputPath: string; fs: Record<string, string> } = picker().compilation(id)) {
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
      setFormatStatus(`Formatting failed: ${compilerDiagnostics(error, source, picker().inputPath(id)).map((item) => item.message).join('\n')}`, 'error');
    } finally { formatButton.disabled = false; }
  }
  formatButton.addEventListener('click', () => void formatSource());
  part('clear-source').addEventListener('click', () => {
    if (editor.replaceSource('', 'delete.clear')) setActivity('Source cleared. Undo with ⌘Z / Ctrl+Z.');
    editor.view.focus();
  });
  ai = setupAiAssistant(scope, {
    read: () => ({ source: editor.source, name: documentName, board: viewer.currentBoard?.id ?? 'root', revision: documentRevision }),
    validate: async (source) => {
      try { await compileSource(source); }
      catch (error) {
        if (!isEngineUnavailable(error)) throw error;
        throw new AiError('The diagram engine is unavailable, so the AI change could not be checked. Your source is unchanged; retry the preview, then send again.', describeError(error));
      }
    },
    apply: (source) => editor.applyAi(source),
    onStatus: (message, kind) => setActivity(message, kind),
    undo: () => editor.undo(),
    revealChange: () => { showView('source'); editor.revealAiChange(); },
    dismissHighlights: () => editor.clearAiHighlights(),
  });

  /** The project around a compiled file, so lint checks its links to other files. */
  function lintFiles(inputPath: string) {
    const context = projectSources();
    const key = currentDocumentKey;
    if (!context || !key) return undefined;
    return { inputPath, exists: (path: string) => Object.hasOwn(context.fs, path), boards: (path: string) => compiledBoards.get(siblingKey(key, path)) };
  }
  function updateLint() {
    if (!lintDocument || mappedSource !== editor.source) return;
    const result = !missingBacklink.checked && !boundaryPorts.checked && defaultLint ? defaultLint
      : lint(lintDocument, { missingBacklink: missingBacklink.checked, boundaryPorts: boundaryPorts.checked, files: lintFiles(lintDocument.inputPath) });
    setEditorDiagnostics(lintDiagnostics(result.diagnostics, editor.source, sourceMap, lintDocument.inputPath));
    const errors = result.diagnostics.filter((item) => item.severity === 'error').length;
    const warnings = result.diagnostics.length - errors;
    setText(lintSummary, errors || warnings ? `${plural(errors, 'lint error')}, ${plural(warnings, 'warning')}` : 'No lint issues');
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
    if (item.filename === picker().inputPath(id)) {
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

  async function highlightSelection(navigate: boolean) {
    if (mappedSource !== editor.source) return;
    const { from, to, empty } = editor.selection;
    if (selectionCleared?.from !== from || selectionCleared.to !== to) selectionCleared = undefined;
    const matches = sourceMap.filter((entry) => empty
      ? from >= entry.from && from < entry.to : from < entry.to && to > entry.from);
    const current = viewer.currentBoard?.id;
    const target = matches.find((entry) => entry.board === current) ?? matches[0];
    revealButton.disabled = !target;
    if (navigate && target && target.board !== current) await viewer.navigate(target.board);
    const shapes = selectionCleared ? [] : matches.filter((entry) => entry.board === viewer.currentBoard?.id).map((entry) => entry.shape);
    viewer.highlightShapes(shapes);
    boardTools.select([...new Set(shapes)]);
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
    boardTools.boardChanged();
    showBoardSource(true);
    void highlightSelection(false);
  });
  function selectShape(event: MouseEvent | KeyboardEvent) {
    const shape = event.target instanceof Element ? event.target.closest<SVGElement>('[data-shape-id]')
      ?? event.target.closest('a')?.querySelector<SVGElement>('[data-shape-id]') : null;
    // A click on the background clears the selection on the diagram, even before it updates; the source cursor
    // stays where it is.
    if (!shape && event instanceof MouseEvent) {
      const { from, to } = editor.selection;
      selectionCleared = { from, to };
      viewer.highlightShapes([]);
      boardTools.select([]);
      return;
    }
    if (mappedSource !== editor.source) return;
    const entry = shape && sourceMap.find((item) => item.board === viewer.currentBoard?.id && item.shape === shape.dataset.shapeId);
    if (!entry) return;
    const anchor = shape.closest('a');
    // A click on a step or topic that opens a board selects it; only its arrow badge opens the board.
    const linked = Boolean(anchor) && !(anchor!.dataset.follow === 'badge' && event instanceof MouseEvent &&
      !(event.target instanceof Element && event.target.closest('.appendix-icon')));
    if (event instanceof KeyboardEvent) {
      if (event.key !== 'Enter' && event.key !== ' ' || linked && !event.altKey) return;
      event.preventDefault();
      event.stopImmediatePropagation();
    }
    if (linked && event.altKey) { event.preventDefault(); event.stopImmediatePropagation(); }
    // Steps and topics of a builder board are edited on the diagram, so selecting one keeps focus there.
    const onCanvas = !linked && !event.altKey && boardTools.editsOnCanvas(entry.shape);
    if (onCanvas) shape.focus({ preventScroll: true });
    else if (!linked || event.altKey) showView('source');
    selectionCleared = undefined;
    editor.select(entry, !onCanvas && (!linked || event.altKey));
    void highlightSelection(false);
  }
  viewer.stage.addEventListener('click', selectShape, { capture: true });
  viewer.stage.addEventListener('keydown', selectShape, { capture: true });
  setupCanvasGuidance(viewer.stage, viewport.setGuidance, () => sourceMap.length > 0 && mappedSource === editor.source,
    () => {
      if (root.hasAttribute('data-fullscreen')) root.querySelector<HTMLButtonElement>('.zf-fullscreen-toggle')!.click();
      showView('source'); editor.view.focus();
    }, (target) => boardTools.canvasKeys(target));

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
    notice.hide();
    const startupTimer = !shared.compiler.ready ? setTimeout(() => {
      if (request !== generation) return;
      notice.show('Loading the diagram engine… The first download can take a moment. You can keep editing.', 'status');
    }, 1200) : undefined;
    try {
      const { d2 } = await shared.compiler.get();
      clearTimeout(startupTimer);
      if (request !== generation) return;
      notice.hide();
      slowTimer = setTimeout(() => {
        if (attempt !== previewAttempt) return;
        notice.show('The preview is taking longer than usual. You can keep editing, wait, or restart the engine to preview your latest source.', 'status', 'Restart preview');
      }, 15_000);
      const compiled = await compileSource(source);
      if (request !== generation) return;
      // D2 registers fonts at compile time for both text measurement and rendering.
      // This diagram carries that family into every viewer/export render call.
      const render: RenderBoard = (target) => d2.render(compiled.diagram, {
        ...compiled.renderOptions, target, noXMLTag: true,
      });
      const linted = lint(compiled, { files: lintFiles(compiled.inputPath) });
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
        compileError.hide(true);
        const boards = indexBoards(compiled.diagram);
        if (currentDocumentKey?.startsWith('project:')) compiledBoards.set(currentDocumentKey, new Set([...boards.values()].map((board) => board.hash)));
        blocks = boardBlocks(compiled.graph, source, compiled.inputPath);
        const sites = boardSites(source, blocks, boards);
        boardTools.compiled(source, sites, boards);
        linkPreview.compiled(boards, sites, render);
        showBoardSource(false);
        void highlightSelection(false);
        const renderSource = async (glyphs: string) => {
          const { d2: engine, fonts } = await shared.compiler.get();
          const result = await engine.compile(glyphs, { ...fonts, layout: 'elk', themeID: 0, darkThemeID: 200 });
          return engine.render(result.diagram, { ...result.renderOptions, noXMLTag: true });
        };
        sourceError = false;
        documentExport = { diagram: compiled.diagram, render, name, diagnostics, renderSource };
        shared.exportChanged();
        setPreviewState('ready');
        // Show a board or shape an edit just made.
        void boardTools.settled();
      }
    } catch (error) {
      if (request === generation) {
        if (error instanceof CompilerStartupError) {
          setEditorDiagnostics([]);
          compileError.hide();
          setText(lintSummary, '');
          notice.show('The diagram engine could not start. Check your connection and retry. Your source is preserved.', 'alert', 'Retry preview');
          setPreviewState('unavailable');
          return;
        }
        const filename = picker().inputPath(id);
        const diagnostics = compilerDiagnostics(error, source, filename);
        setEditorDiagnostics(diagnostics);
        lintDocument = undefined;
        setText(lintSummary, plural(diagnostics.length, 'source error'));
        sourceError = true;
        shared.exportChanged();
        const first = diagnostics[0];
        const externalCompilerError = first.filename && first.filename !== filename ? first : undefined;
        const message = first.message.replace(/^[^:]+:\d+:\d+:\s*/, '');
        compileError.show(externalCompilerError
          ? `Error · ${first.message}` : first.range ? `Error · Line ${first.line}, column ${first.column}: ${message}` : `Error · Source location unavailable: ${message}`,
        externalCompilerError ? `Open ${externalCompilerError.filename}` : 'Go to error', canOpenDiagnostic(first));
        viewer.setMessage('');
        setPreviewState('error');
      }
    } finally {
      clearTimeout(startupTimer);
      clearTimeout(slowTimer);
      if (attempt === previewAttempt && notice.offersRestart) notice.hide();
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
    get sourceError() { return sourceError; },
    /** The preview reflects the current source, so exports and source selection are valid. */
    get current() { return mappedSource === editor.source; },
    replaceDocument,
    save: () => saveFileButton.click(),
    /** Name the document for its exports and downloads; returns the name it was given. */
    rename(name: string) {
      const renamed = picker().rename(id, name);
      if (!renamed) return documentName;
      // The file on disk keeps its name, so the next save asks where to save under the new one.
      const linked = shared.fileHandles.delete(renamed.key);
      adopt(renamed);
      setActivity(`Renamed to ${renamed.name}.${linked ? ' Save asks where to save it.' : ''}`);
      return documentName;
    },
    /** Show a document restored on startup, keeping its board from the page URL. */
    open(document: { key: string; name: string; source: string }) {
      ai?.documentSwitched();
      sourceError = false;
      documentName = document.name;
      currentDocumentKey = document.key;
      // A reload keeps the files the first pane came through, which its history entry recorded.
      setFileStack(id === 'a' && history.state?.zoomflowFile === document.key ? savedStack(history.state.zoomflowFiles) : []);
      delete root.dataset.empty;
      viewport.setDocument(document.key);
      editor.open(document.key, document.source);
      boardTools.refresh();
      picker().refresh();
      clearTimeout(debounce);
      void load(editor.source, documentName);
    },
    /** Leave the pane without a document, for example when its draft is removed. */
    close() {
      sourceError = false;
      clearTimeout(debounce);
      clearTimeout(previewTimer);
      previewTimer = undefined;
      // Like opening another document: pending format and AI results no longer apply.
      ++documentRevision;
      ai?.cancel();
      ai?.sourceChanged();
      ++generation;
      previewQueue.invalidate();
      viewer.cancelPendingRender();
      viewer.setBusy(false);
      currentDocumentKey = undefined;
      setFileStack([]);
      documentName = '';
      documentExport = undefined;
      root.dataset.empty = 'true';
      root.querySelector('.pane-document-name')!.textContent = 'Choose a diagram';
      root.querySelector<HTMLElement>('.pane-document .draft-unsaved')!.hidden = true;
      if (notice.owned) notice.hide();
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
      const canSave = Boolean(handle) || canChooseSaveFile();
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
    /** A closed split keeps the second pane for reopening; it releases page-level listeners meanwhile. */
    suspend: () => viewer.suspend(),
    resume: () => viewer.resume(),
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
