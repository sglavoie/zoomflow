import { displayTitle } from './text';
import { examples } from './examples';
import { setupPaneEditing } from './pane-editing';
import { setupPaneLifecycle } from './pane-lifecycle';
import { projectLabel, statusLine, type DocumentExport, type PaneContext, type FileVisit } from './document-pane-shared';
import { setupPaneSelection } from './pane-selection';
import { setupPanePreview } from './pane-preview';
import { setupPaneProject } from './pane-project';
import { classifyHref, indexBoards, indexDiagramSearch, type CompileResponse, type ShapeSource, type SourceRange, type LintResult } from '@zoomflow/core';
import { Viewer, openFolderMessage, setupViewport, type RenderBoard, type ViewerRoute } from '@zoomflow/viewer';
import { SourceEditor } from './editor';
import type { SourceDiagnostic } from './diagnostics';
import { createPreviewQueue } from './preview-queue';
import { setupFullscreen } from './fullscreen';
import type { setupAiAssistant } from './ai-assistant';
import { setupMobileView } from './mobile-view';
import { projectIdOf } from './project-files';
import { setupCanvasGuidance } from './canvas-guidance';
import { setupBoardTools } from './board-tools';
import { setupLinkPreview } from './link-preview';
import { paneScope, type PaneId } from './pane-scope';
import { paneNotice } from './engine-notice';
import { setupCompileError } from './compile-error';
import { setupSaveFile } from './save-file';
import { restoreField } from './field-preference';

export type { PaneId } from './pane-scope';
export type { DocumentExport, PaneContext } from './document-pane-shared';
/** One document's editor, preview, diagnostics and status. The workspace shows one or two panes. */
export function createDocumentPane(id: PaneId, root: HTMLElement, shared: PaneContext) {
  // Lazy accessors share live state with the feature modules, including controls initialized below.
  const { showBoardSource, highlightSelection, focusSourceBoard, revealSelection, selectShape } = setupPaneSelection({
    get mappedSource() { return mappedSource; }, set mappedSource(value) { mappedSource = value; },
    get editor() { return editor; },
    get viewer() { return viewer; },
    get blocks() { return blocks; }, set blocks(value) { blocks = value; },
    get selectionCleared() { return selectionCleared; }, set selectionCleared(value) { selectionCleared = value; },
    get sourceMap() { return sourceMap; }, set sourceMap(value) { sourceMap = value; },
    get revealButton() { return revealButton; },
    get boardTools() { return boardTools; },
    get documentRevision() { return documentRevision; }, set documentRevision(value) { documentRevision = value; },
    get showView() { return showView; },
    get viewport() { return viewport; },
    get touchDown() { return touchDown; }, set touchDown(value) { touchDown = value; },
    get shared() { return shared; },
  });

  const { invalidateSource, compileSource, updateLint, canOpenDiagnostic, openDiagnostic, load } = setupPanePreview({
    get previewTimer() { return previewTimer; }, set previewTimer(value) { previewTimer = value; },
    get previewStatus() { return previewStatus; },
    get lintSummary() { return lintSummary; },
    get viewer() { return viewer; },
    get activeDiagnostics() { return activeDiagnostics; }, set activeDiagnostics(value) { activeDiagnostics = value; },
    get part() { return part; },
    get editor() { return editor; },
    get picker() { return picker; },
    get id() { return id; },
    get documentName() { return documentName; }, set documentName(value) { documentName = value; },
    get diagnosticsButton() { return diagnosticsButton; },
    get boardTools() { return boardTools; },
    get generation() { return generation; }, set generation(value) { generation = value; },
    get previewQueue() { return previewQueue; },
    get documentRevision() { return documentRevision; }, set documentRevision(value) { documentRevision = value; },
    get ai() { return ai; }, set ai(value) { ai = value; },
    get setFormatStatus() { return setFormatStatus; },
    get sourceMap() { return sourceMap; }, set sourceMap(value) { sourceMap = value; },
    get revealButton() { return revealButton; },
    get lintDocument() { return lintDocument; }, set lintDocument(value) { lintDocument = value; },
    get documentExport() { return documentExport; }, set documentExport(value) { documentExport = value; },
    get shared() { return shared; },
    get setActivity() { return setActivity; },
    get compileError() { return compileError; },
    get mappedSource() { return mappedSource; }, set mappedSource(value) { mappedSource = value; },
    get missingBacklink() { return missingBacklink; },
    get boundaryPorts() { return boundaryPorts; },
    get defaultLint() { return defaultLint; }, set defaultLint(value) { defaultLint = value; },
    get lintFiles() { return lintFiles; },
    get showView() { return showView; },
    get replaceDocument() { return replaceDocument; },
    get currentDocumentKey() { return currentDocumentKey; }, set currentDocumentKey(value) { currentDocumentKey = value; },
    get previewAttempt() { return previewAttempt; }, set previewAttempt(value) { previewAttempt = value; },
    get notice() { return notice; },
    get initialLayerRoot() { return initialLayerRoot; }, set initialLayerRoot(value) { initialLayerRoot = value; },
    get blocks() { return blocks; }, set blocks(value) { blocks = value; },
    get linkPreview() { return linkPreview; },
    get showBoardSource() { return showBoardSource; },
    get highlightSelection() { return highlightSelection; },
    get sourceError() { return sourceError; }, set sourceError(value) { sourceError = value; },
  });

  const { projectSources, showsAtlas, linkedPath, fileLabel, linkedBoards, createLinkedFile, compileLinkedFile, compileProjectFile, setFileStack, openProjectMatch, openFileLink, returnToFile, savedStack, restoreFromHistory, openAtlasMap, lintFiles } = setupPaneProject({
    get picker() { return picker; },
    get id() { return id; },
    get currentDocumentKey() { return currentDocumentKey; }, set currentDocumentKey(value) { currentDocumentKey = value; },
    get shared() { return shared; },
    get setActivity() { return setActivity; },
    get linkedCompiles() { return linkedCompiles; },
    get compileSource() { return compileSource; },
    get fileStack() { return fileStack; }, set fileStack(value) { fileStack = value; },
    get viewer() { return viewer; },
    get replaceDocument() { return replaceDocument; },
    get boardTools() { return boardTools; },
    get documentOpens() { return documentOpens; }, set documentOpens(value) { documentOpens = value; },
    get editor() { return editor; },
    get mappedSource() { return mappedSource; }, set mappedSource(value) { mappedSource = value; },
    get sourceError() { return sourceError; }, set sourceError(value) { sourceError = value; },
    get atlasRequest() { return atlasRequest; }, set atlasRequest(value) { atlasRequest = value; },
    get showView() { return showView; },
  });

  const scope = paneScope(id, root);
  const { part } = scope;
  const picker = () => shared.picker();

  const fileLinks = {
    exists: (path: string) => {
      const target = linkedPath(path);
      return target !== undefined && Object.hasOwn(projectSources()!.fs, target);
    },
    open: (path: string, hash: string) => openFileLink(path, hash),
    label: fileLabel,
    // Project paths distinguish files with the same basename in breadcrumbs.
    name: () => showsAtlas() ? undefined : projectLabel(picker().inputPath(id)),
  };
  const viewer = new Viewer(part('viewer'), { history: id === 'a', active: shared.isActive,
    name: () => showsAtlas() ? 'Atlas' : examples.find(example => example.name === currentDocumentKey)?.title ?? displayTitle(documentName),
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
    view: { read: key => picker().readView(key), write: shared.viewChanged },
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
  /** A newly imported document has saved layer settings but no session navigation route yet. */
  let initialLayerRoot: string | undefined;
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
  restoreField(missingBacklink, 'zoomflow.missing-backlink.v1');
  restoreField(boundaryPorts, 'zoomflow.boundary-ports.v1');
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
  const setActivity = statusLine(activityStatus);
  const setFormatStatus = statusLine(formatStatus);
  let lintDocument: CompileResponse | undefined;
  /** Lint with default options, computed once per compile for the viewer and exports. */
  let defaultLint: LintResult | undefined;
  const editor = new SourceEditor(part('editor'), {
    panelId: scope.id('diagnostics-panel'),
    changed: () => {
      invalidateSource();
      picker().updateCurrent(id, editor.source);
      boardTools.refreshSearch();
      if (currentDocumentKey?.startsWith('project:')) shared.projectChanged(projectIdOf(currentDocumentKey)!);
      clearTimeout(debounce);
      debounce = setTimeout(() => void load(editor.source, documentName, true), immediate ? 0 : 350);
      immediate = false;
    },
    selected: () => { selectionCleared = undefined; void highlightSelection(false); },
    sourceClicked: (position) => void focusSourceBoard(position),
    format: () => void editing.formatSource(),
    reveal: () => void revealSelection(),
    label: id === 'a' ? 'D2 source' : 'D2 source, second diagram',
  });
  const boardTools = setupBoardTools(scope, viewer, {
    builders: { flow: shared.flowBuilder, 'mind map': shared.mindMapBuilder },
    source: () => editor.source,
    document: () => currentDocumentKey,
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
    revealMatch: (shape) => {
      showView('preview');
      viewport.refresh();
      if (shape === undefined) { viewer.stage.focus({ preventScroll: true }); return; }
      const entry = sourceMap.find(item => item.board === viewer.currentBoard?.id && item.shape === shape);
      if (entry && mappedSource === editor.source) {
        selectionCleared = undefined;
        editor.select(entry, false);
      }
      // Imported shapes can be found too, even when their source is in another file.
      viewer.highlightShapes([shape]);
      boardTools.select([shape]);
      const element = [...viewer.stage.querySelectorAll<SVGGraphicsElement>('[data-shape-id]')].find(node => node.dataset.shapeId === shape &&
        node.dataset.shapeBoard === viewer.currentBoard?.id);
      if (!element) { viewer.stage.focus({ preventScroll: true }); return; }
      const target = element.closest<SVGElement>('a') ?? element;
      if (!target.hasAttribute('tabindex')) target.setAttribute('tabindex', '-1');
      target.focus({ preventScroll: true });
      viewport.reveal([element]);
    },
    projectSearch: {
      available: () => currentDocumentKey !== undefined && projectIdOf(currentDocumentKey) !== undefined,
      read: () => {
        const project = currentDocumentKey && projectIdOf(currentDocumentKey);
        return project === undefined || project === '' ? undefined : { id: project, fs: picker().projectSources(project).fs };
      },
      compile: async (path, fs) => {
        const boards = indexBoards((await compileSource(fs[path], { inputPath: path, fs })).diagram);
        return indexDiagramSearch(boards).map(entry => ({ ...entry, hash: boards.get(entry.board)!.hash }));
      },
      activate: openProjectMatch,
    },
    projectCheck: {
      available: () => currentDocumentKey !== undefined && projectIdOf(currentDocumentKey) !== undefined,
      read: () => {
        const project = currentDocumentKey && projectIdOf(currentDocumentKey);
        return project ? { id: project, fs: picker().projectSources(project).fs,
          options: { missingBacklink: missingBacklink.checked, boundaryPorts: boundaryPorts.checked } } : undefined;
      },
      compile: (path, fs) => compileSource(fs[path], { inputPath: path, fs }),
      activate: async (item) => {
        if (canOpenDiagnostic(item)) { await openDiagnostic(item); return; }
        // Compiler/layout failures can lack a range; still let the user open the file that failed.
        if (!item.filename) return;
        if (item.filename === picker().inputPath(id) && !showsAtlas()) { showView('source'); editor.view.focus(); return; }
        const target = picker().selectProjectPath(id, item.filename);
        if (!target) return;
        if (target.pane !== id) { shared.revealSource(target.pane); return; }
        await replaceDocument(target.source, target.name, target.key);
        if (currentDocumentKey === target.key) { showView('source'); editor.view.focus(); }
      },
    },
    status: (message, kind) => setActivity(message, kind),
    undo: () => { immediate = true; editor.undo(); immediate = false; },
    redo: () => { immediate = true; editor.redo(); immediate = false; },
    readOnly: showsAtlas,
    files: () => {
      const context = projectSources();
      if (!context) return;
      return {
        key: currentDocumentKey!,
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
  const linkPreview = setupLinkPreview(scope, viewer, {
    label: fileLabel,
    missing: (path) => !projectSources() ? openFolderMessage : fileLinks.exists(path) ? undefined : `Missing file: ${fileLabel(path)}`,
    compile: (path) => compileLinkedFile(linkedPath(path)!),
  });
  /** One compile per linked file of a project and that project's sources, for previews of the boards links open.
   * Every source counts, since the file may import any of them, directly or through other imports. */
  const linkedCompiles = new Map<string, { sources: string; result: Promise<{ boards: ReturnType<typeof indexBoards>; render: RenderBoard }> }>();
  let atlasRequest = 0;
  /** Counts documents shown in this pane, so work for one is abandoned when another opens, even the same one again. */
  let documentOpens = 0;

  /** Take on a saved or renamed draft's key and name, which a saved or renamed example changes. */
  function adopt(saved: { key: string; name: string }) {
    if (saved.key !== currentDocumentKey) {
      editor.copyDocument(saved.key);
      viewport.copyDocument(saved.key);
      viewer.copyLayerDocument(saved.key);
      const route = shared.documentRoutes.get(currentDocumentKey!);
      if (route) shared.documentRoutes.set(saved.key, route);
    }
    currentDocumentKey = saved.key;
    documentName = saved.name;
    viewer.refreshName();
    setActivity('');
    // Identity changes do not invalidate compiled geometry or editor history.
    picker().refresh();
  }
  setupSaveFile(saveFileButton, {
    fileHandles: shared.fileHandles, picker,
    downloaded: () => picker().markDownloadRequested(id),
    key: () => showsAtlas() ? undefined : currentDocumentKey, name: () => documentName, source: () => editor.source,
    adopt: shared.adoptSaved,
    setActivity, activity: () => activityStatus.textContent,
  });

  /** Show a document; `route` overrides its remembered board. Without `stack`, it starts a new way through files. */
  async function replaceDocument(source: string, name: string, key: string, reset = false, route?: ViewerRoute, stack: FileVisit[] = []) {
    ++documentOpens;
    boardTools.resetSearch();
    ai?.documentSwitched();
    sourceError = false;
    const rememberedRoute = reset ? undefined : route ?? shared.documentRoutes.get(key);
    initialLayerRoot = !reset && !rememberedRoute ? picker().readView(key).layers?.root : undefined;
    viewer.setRoute(rememberedRoute);
    // The first pane's history entry now shows this document, so a reload or Back here restores its own files on the way.
    if (id === 'a') history.replaceState({ ...history.state, zoomflowFile: key, zoomflowFiles: stack }, '');
    viewport.setDocument(key, reset);
    documentName = name;
    currentDocumentKey = key;
    setFileStack(stack);
    delete root.dataset.empty;
    picker().refresh();
    editor.open(key, source, reset, key.startsWith('atlas:'));
    invalidateSource();
    compileError.hide();
    clearTimeout(debounce);
    await load(source, name);
  }

  const editing = setupPaneEditing({
    formatButton, showsAtlas, setFormatStatus, editor, compileSource, picker, id, part, setActivity,
    scope, viewer, missingBacklink, boundaryPorts, lintFiles, showView,
    get documentRevision() { return documentRevision; },
    get mappedSource() { return mappedSource; },
    get lintDocument() { return lintDocument; },
    get documentName() { return documentName; },
    get activeDiagnostics() { return activeDiagnostics; },
  });
  ai = editing.ai;
  for (const option of [missingBacklink, boundaryPorts]) option.addEventListener('change', () => { updateLint(); shared.lintChanged(); });
  diagnosticsButton.addEventListener('click', () => {
    showView('source');
    editor.showDiagnostics();
  });
  revealButton.addEventListener('click', () => void revealSelection());
  const boardChanged = () => {
    // Viewer commits its URL and trail immediately after dispatching this event.
    queueMicrotask(() => {
      if (currentDocumentKey) shared.documentRoutes.set(currentDocumentKey, viewer.route);
      shared.exportChanged();
    });
    boardTools.boardChanged();
    showBoardSource(true);
    void highlightSelection(false);
  };
  viewer.stage.addEventListener('zf-boardchange', boardChanged);
  viewer.stage.addEventListener('zf-activeboardchange', boardChanged);
  viewer.stage.addEventListener('zf-visibilitychange', () => shared.exportChanged());
  // WebKit dispatches a MouseEvent for a touch-generated click, so remember the pointer that began it.
  let touchDown: { shape: SVGElement; at: number } | undefined;
  viewer.stage.addEventListener('pointerdown', (event) => {
    const shape = event.target instanceof Element ? event.target.closest<SVGElement>('[data-shape-id]') : null;
    touchDown = event.pointerType === 'touch' && shape ? { shape, at: event.timeStamp } : undefined;
  }, { capture: true });
  viewer.stage.addEventListener('click', selectShape, { capture: true });
  viewer.stage.addEventListener('keydown', selectShape, { capture: true });
  setupCanvasGuidance(viewer.stage, viewport.setGuidance, () => sourceMap.length > 0 && mappedSource === editor.source,
    () => {
      if (root.hasAttribute('data-fullscreen')) root.querySelector<HTMLButtonElement>('.zf-fullscreen-toggle')!.click();
      showView('source'); editor.view.focus();
    }, (target) => boardTools.canvasKeys(target), { available: boardTools.canStartEmpty, start: boardTools.startEmpty });
  let previewAttempt: symbol;
  const { pane } = setupPaneLifecycle({
    get id() { return id; },
    get root() { return root; },
    get scope() { return scope; },
    get viewer() { return viewer; },
    get editor() { return editor; },
    get viewport() { return viewport; },
    get showView() { return showView; },
    get views() { return views; },
    get setActivity() { return setActivity; },
    get currentDocumentKey() { return currentDocumentKey; }, set currentDocumentKey(value) { currentDocumentKey = value; },
    get documentName() { return documentName; }, set documentName(value) { documentName = value; },
    get generation() { return generation; }, set generation(value) { generation = value; },
    get documentOpens() { return documentOpens; }, set documentOpens(value) { documentOpens = value; },
    get documentExport() { return documentExport; }, set documentExport(value) { documentExport = value; },
    get sourceError() { return sourceError; }, set sourceError(value) { sourceError = value; },
    get documentRevision() { return documentRevision; }, set documentRevision(value) { documentRevision = value; },
    get mappedSource() { return mappedSource; }, set mappedSource(value) { mappedSource = value; },
    get load() { return load; },
    get boardTools() { return boardTools; },
    get compileProjectFile() { return compileProjectFile; },
    get replaceDocument() { return replaceDocument; },
    get adopt() { return adopt; },
    get showsAtlas() { return showsAtlas; },
    get invalidateSource() { return invalidateSource; },
    get debounce() { return debounce; }, set debounce(value) { debounce = value; },
    get saveFileButton() { return saveFileButton; },
    get openAtlasMap() { return openAtlasMap; },
    get picker() { return picker; },
    get shared() { return shared; },
    get ai() { return ai; }, set ai(value) { ai = value; },
    get setFileStack() { return setFileStack; },
    get savedStack() { return savedStack; },
    get previewTimer() { return previewTimer; }, set previewTimer(value) { previewTimer = value; },
    get previewQueue() { return previewQueue; },
    get notice() { return notice; },
    get linkedCompiles() { return linkedCompiles; },
    get part() { return part; },
    get draftStatus() { return draftStatus; },
    get missingBacklink() { return missingBacklink; },
    get boundaryPorts() { return boundaryPorts; },
    get updateLint() { return updateLint; },
    get setFormatStatus() { return setFormatStatus; },
  });

  return pane;
}
export type DocumentPane = ReturnType<typeof createDocumentPane>;
