import { boardBlocks, indexBoards, indexShapeSources, parseSourceRange, lint, rebaseFileLinks, type CompileResponse, type ShapeSource, type SourceRange, type LintResult } from '@zoomflow/core';
import { type Viewer, ViewerRenderError, type RenderBoard, type ViewerRoute } from '@zoomflow/viewer';
import type { SourceEditor } from './editor';
import { compilerDiagnostics, lintDiagnostics, type SourceDiagnostic } from './diagnostics';
import { CompilerStartupError } from './compiler';
import type { createPreviewQueue } from './preview-queue';
import type { setupAiAssistant } from './ai-assistant';
import { projectFileSystem } from './project-files';
import type { setupBoardTools } from './board-tools';
import type { setupLinkPreview } from './link-preview';
import { boardSites } from './board-model';
import { exampleSource } from './draft-library';
import type { PaneId } from './pane-scope';
import type { paneNotice } from './engine-notice';
import type { setupCompileError } from './compile-error';
import { plural, setText } from './text';
import { compiledBoards, type FileVisit, type PaneContext, type DocumentExport } from './document-pane-shared';

interface Context {
  previewTimer: ReturnType<typeof setTimeout> | undefined;
  previewStatus: HTMLElement;
  lintSummary: HTMLElement;
  viewer: Viewer;
  activeDiagnostics: SourceDiagnostic[];
  part: <T extends HTMLElement = HTMLElement>(name: string) => T;
  editor: SourceEditor;
  picker: PaneContext['picker'];
  id: PaneId;
  documentName: string;
  diagnosticsButton: HTMLButtonElement;
  boardTools: ReturnType<typeof setupBoardTools>;
  generation: number;
  previewQueue: ReturnType<typeof createPreviewQueue>;
  documentRevision: number;
  ai: ReturnType<typeof setupAiAssistant> | undefined;
  setFormatStatus: (message: string, kind?: 'info' | 'error') => void;
  sourceMap: ShapeSource[];
  revealButton: HTMLButtonElement;
  lintDocument: CompileResponse | undefined;
  documentExport: DocumentExport | undefined;
  shared: PaneContext;
  setActivity: (message: string, kind?: 'info' | 'error') => void;
  compileError: ReturnType<typeof setupCompileError>;
  mappedSource: string | undefined;
  missingBacklink: HTMLInputElement;
  boundaryPorts: HTMLInputElement;
  defaultLint: LintResult | undefined;
  lintFiles: (inputPath: string) => import('@zoomflow/core').LintOptions['files'];
  showView: (view: 'preview' | 'source') => void;
  replaceDocument: (source: string, name: string, key: string, reset?: boolean, route?: ViewerRoute, stack?: FileVisit[]) => Promise<void>;
  currentDocumentKey: string | undefined;
  previewAttempt: symbol;
  notice: ReturnType<typeof paneNotice>;
  initialLayerRoot: string | undefined;
  blocks: Map<string, SourceRange>;
  linkPreview: ReturnType<typeof setupLinkPreview>;
  showBoardSource: (opened: boolean) => void;
  highlightSelection: (navigate: boolean) => Promise<void>;
  sourceError: boolean;
}

export function setupPanePreview(ctx: Context) {
  function setPreviewState(state: 'loading' | 'updating' | 'ready' | 'error' | 'unavailable') {
    if (state === 'updating') {
      if (ctx.previewTimer || ctx.previewStatus.dataset.state === 'updating') return;
      ctx.previewTimer = setTimeout(() => {
        ctx.previewTimer = undefined;
        ctx.previewStatus.dataset.state = 'updating';
        setText(ctx.previewStatus, 'Updating preview…');
        setText(ctx.lintSummary, 'Checking diagnostics…');
        ctx.viewer.stage.dataset.previewState = 'updating';
      }, 700);
      return;
    }
    clearTimeout(ctx.previewTimer);
    ctx.previewTimer = undefined;
    ctx.previewStatus.dataset.state = state;
    setText(ctx.previewStatus, { loading: 'Loading preview…',
      ready: 'Preview ready', error: 'Preview out of date', unavailable: 'Preview unavailable' }[state]);
    if (state === 'error' || state === 'unavailable') ctx.viewer.stage.dataset.previewState = 'stale';
    else if (state === 'loading') ctx.viewer.stage.dataset.previewState = 'loading';
    else delete ctx.viewer.stage.dataset.previewState;
    ctx.viewer.stage.dispatchEvent(new Event('zf-previewstate'));
  }

  function setEditorDiagnostics(diagnostics: SourceDiagnostic[]) {
    // Edits clear diagnostics on every keystroke; skip the work when there are none.
    if (!diagnostics.length && !ctx.activeDiagnostics.length) return;
    ctx.activeDiagnostics = diagnostics;
    const errors = diagnostics.filter((item) => item.severity === 'error').length;
    const warnings = diagnostics.length - errors;
    ctx.part('mobile-source').textContent = errors ? `Source · ${plural(errors, 'error')}`
      : warnings ? `Source · ${plural(warnings, 'warning')}` : 'Source';
    ctx.editor.diagnostics(diagnostics, ctx.picker().inputPath(ctx.id), ctx.documentName, canOpenDiagnostic, (item) => void openDiagnostic(item));
    ctx.diagnosticsButton.disabled = diagnostics.length === 0;
    ctx.diagnosticsButton.textContent = diagnostics.length ? `Diagnostics (${diagnostics.length})` : 'Diagnostics';
    ctx.diagnosticsButton.setAttribute('aria-label', `Review ${plural(diagnostics.length, 'diagnostic')}`);
  }

  function invalidateSource() {
    ctx.viewer.stage.classList.remove('zf-starter-preview');
    ctx.boardTools.invalidate();
    // Invalidate immediately, including requests still awaiting WASM/render startup.
    ++ctx.generation;
    ctx.previewQueue.invalidate();
    ++ctx.documentRevision;
    ctx.ai?.sourceChanged();
    ctx.viewer.setBusy(true);
    ctx.setFormatStatus('');
    ctx.viewer.cancelPendingRender();
    ctx.sourceMap = [];
    ctx.revealButton.disabled = true;
    ctx.lintDocument = undefined;
    setEditorDiagnostics([]);
    ctx.viewer.highlightShapes([]);
    ctx.documentExport = undefined;
    ctx.shared.exportChanged();
    setPreviewState(ctx.viewer.stage.querySelector('svg') ? 'updating' : 'loading');
    ctx.setActivity('');
    ctx.shared.clearFileError();
    ctx.shared.setExportStatus('');
    ctx.compileError.invalidate();
    ctx.viewer.stage.dispatchEvent(new Event('zf-sourcechange'));
  }

  async function compileSource(source: string, context: { inputPath: string; fs: Record<string, string> } = ctx.picker().compilation(ctx.id)) {
    const { d2, fonts } = await ctx.shared.compiler.get();
    const input = projectFileSystem(context.inputPath, context.fs, source);
    const padValue = new URLSearchParams(location.search).get('pad');
    const pad = padValue === null ? 100 : Number(padValue);
    return d2.compile(input, {
      ...fonts,
      layout: 'elk', themeID: 0, darkThemeID: 200,
      pad: Number.isFinite(pad) && pad >= 0 ? pad : 100,
    });
  }

  function updateLint() {
    ctx.boardTools.refreshSearch();
    if (!ctx.lintDocument || ctx.mappedSource !== ctx.editor.source) return;
    const result = !ctx.missingBacklink.checked && !ctx.boundaryPorts.checked && ctx.defaultLint ? ctx.defaultLint
      : lint(ctx.lintDocument, { missingBacklink: ctx.missingBacklink.checked, boundaryPorts: ctx.boundaryPorts.checked, files: ctx.lintFiles(ctx.lintDocument.inputPath) });
    setEditorDiagnostics(lintDiagnostics(result.diagnostics, ctx.editor.source, ctx.sourceMap, ctx.lintDocument.inputPath));
    const errors = result.diagnostics.filter((item) => item.severity === 'error').length;
    const warnings = result.diagnostics.length - errors;
    setText(ctx.lintSummary, errors || warnings ? `${plural(errors, 'lint error')}, ${plural(warnings, 'warning')}` : 'No lint issues');
    ctx.lintSummary.dataset.empty = String(!errors && !warnings);
  }

  function canOpenDiagnostic(item: SourceDiagnostic) {
    const context = ctx.picker().compilation(ctx.id);
    if (item.filename === context.inputPath) return Boolean(item.range);
    const text = item.filename && context.fs[item.filename];
    return typeof text === 'string' && Boolean(item.rawRange && parseSourceRange(item.rawRange, text, item.filename));
  }

  async function openDiagnostic(item: SourceDiagnostic) {
    if (!canOpenDiagnostic(item)) return;
    ctx.showView('source');
    if (item.filename === ctx.picker().inputPath(ctx.id)) {
      if (item.range) ctx.editor.select(item.range, true);
      return;
    }
    const target = ctx.picker().selectProjectPath(ctx.id, item.filename!);
    if (!target || !item.rawRange) return;
    const range = parseSourceRange(item.rawRange, target.source, item.filename);
    // The other pane already shows that file: select the location there.
    if (target.pane !== ctx.id) { ctx.shared.revealSource(target.pane, range); return; }
    const key = target.key;
    await ctx.replaceDocument(target.source, target.name, key);
    // A second navigation during compilation must not move the new document's cursor.
    if (ctx.currentDocumentKey !== key || ctx.editor.source !== target.source) return;
    if (range) ctx.editor.select(range, true);
  }

  function load(source: string, name: string, preserveViewport = false) {
    return ctx.previewQueue.run(() => loadPreview(source, name, preserveViewport));
  }

  async function loadPreview(source: string, name: string, preserveViewport: boolean) {
    const attempt = ctx.previewAttempt = Symbol();
    let slowTimer: ReturnType<typeof setTimeout> | undefined;
    const request = ++ctx.generation;
    const view = ctx.currentDocumentKey === 'order.d2' ? ctx.picker().readView('order.d2') : undefined;
    ctx.viewer.stage.classList.toggle('zf-starter-preview', ctx.id === 'a' && !ctx.shared.compiler.ready &&
      ctx.currentDocumentKey === 'order.d2' && source === exampleSource('order.d2') &&
      (!location.hash || location.hash === '#/') && !view?.hidden?.length && !view?.layers?.root &&
      !ctx.viewer.stage.querySelector('svg'));
    ctx.viewer.setBusy(true);
    ctx.viewer.setMessage('');
    setPreviewState(ctx.viewer.stage.querySelector('svg') ? 'updating' : 'loading');
    ctx.notice.hide();
    const startupTimer = !ctx.shared.compiler.ready ? setTimeout(() => {
      if (request !== ctx.generation) return;
      ctx.notice.show('Loading the diagram engine… The first download can take a moment. You can keep editing.', 'status');
    }, 1200) : undefined;
    try {
      const { d2 } = await ctx.shared.compiler.get();
      clearTimeout(startupTimer);
      if (request !== ctx.generation) return;
      ctx.notice.hide();
      slowTimer = setTimeout(() => {
        if (attempt !== ctx.previewAttempt) return;
        ctx.notice.show('The preview is taking longer than usual. You can keep editing, wait, or restart the engine to preview your latest source.', 'status', 'Restart preview');
      }, 15_000);
      const compiled = await compileSource(source);
      if (request !== ctx.generation) return;
      // Links written in imported files open what they name from the file shown; lint reads them where written.
      const diagram = rebaseFileLinks(compiled, ctx.picker().inputPath(ctx.id));
      // D2 registers fonts at compile time for both text measurement and rendering.
      // This diagram carries that family into every viewer/export render call.
      const render: RenderBoard = (target) => d2.render(diagram, {
        ...compiled.renderOptions, target, noXMLTag: true,
      });
      const linted = lint(compiled, { files: ctx.lintFiles(compiled.inputPath) });
      const { diagnostics } = linted;
      const compiledSources = indexShapeSources(compiled.diagram, compiled.graph, source, compiled.inputPath);
      ctx.viewer.setSourceShapes(compiledSources);
      if (ctx.initialLayerRoot) {
        // Resolve the saved ID through the compiled boards, including quoted names. Starting at Root
        // would otherwise broaden a saved subtree and change its custom branch selection.
        ctx.viewer.setRoute({ hash: indexBoards(diagram).get(ctx.initialLayerRoot)?.hash ?? '#/' });
        ctx.initialLayerRoot = undefined;
      }
      await ctx.viewer.setDocument(diagram, render, diagnostics, preserveViewport);
      if (request === ctx.generation) {
        ctx.viewer.stage.classList.remove('zf-starter-preview');
        ctx.sourceMap = compiledSources;
        ctx.mappedSource = source;
        ctx.lintDocument = compiled;
        ctx.defaultLint = linted;
        updateLint();
        ctx.compileError.hide(true);
        const boards = indexBoards(diagram);
        if (ctx.currentDocumentKey?.startsWith('project:')) compiledBoards.set(ctx.currentDocumentKey, new Set([...boards.values()].map((board) => board.hash)));
        ctx.blocks = boardBlocks(compiled.graph, source, compiled.inputPath);
        const sites = boardSites(source, ctx.blocks, boards);
        ctx.boardTools.compiled(source, sites, boards, compiled.graph);
        ctx.linkPreview.compiled(boards, sites, render);
        ctx.showBoardSource(false);
        void ctx.highlightSelection(false);
        const renderSource = async (glyphs: string) => {
          const { d2: engine, fonts } = await ctx.shared.compiler.get();
          const result = await engine.compile(glyphs, { ...fonts, layout: 'elk', themeID: 0, darkThemeID: 200 });
          return engine.render(result.diagram, { ...result.renderOptions, noXMLTag: true });
        };
        ctx.sourceError = false;
        ctx.documentExport = { diagram, render, name, diagnostics, renderSource };
        ctx.shared.exportChanged();
        setPreviewState('ready');
        // Show a board or shape an edit just made.
        void ctx.boardTools.settled();
      }
    } catch (error) {
      if (request === ctx.generation) {
        ctx.viewer.stage.classList.remove('zf-starter-preview');
        if (error instanceof CompilerStartupError || error instanceof ViewerRenderError) {
          setEditorDiagnostics([]);
          ctx.compileError.hide();
          setText(ctx.lintSummary, '');
          ctx.notice.show(error instanceof ViewerRenderError
            ? 'The preview could not be drawn. Retry the preview. Your source is preserved.'
            : 'The diagram engine could not start. Check your connection and retry. Your source is preserved.', 'alert', 'Retry preview');
          setPreviewState('unavailable');
          return;
        }
        const filename = ctx.picker().inputPath(ctx.id);
        const diagnostics = compilerDiagnostics(error, source, filename);
        setEditorDiagnostics(diagnostics);
        ctx.lintDocument = undefined;
        setText(ctx.lintSummary, plural(diagnostics.length, 'source error'));
        ctx.sourceError = true;
        ctx.shared.exportChanged();
        const first = diagnostics[0];
        const externalCompilerError = first.filename && first.filename !== filename ? first : undefined;
        const message = first.message.replace(/^[^:]+:\d+:\d+:\s*/, '');
        ctx.compileError.show(externalCompilerError
          ? `Error · ${first.message}` : first.range ? `Error · Line ${first.line}, column ${first.column}: ${message}` : `Error · Source location unavailable: ${message}`,
        externalCompilerError ? `Open ${externalCompilerError.filename}` : 'Go to error', canOpenDiagnostic(first));
        ctx.viewer.setMessage('');
        setPreviewState('error');
      }
    } finally {
      clearTimeout(startupTimer);
      clearTimeout(slowTimer);
      if (attempt === ctx.previewAttempt && ctx.notice.offersRestart) ctx.notice.hide();
      if (request === ctx.generation) ctx.viewer.setBusy(false);
    }
  }
  return { setPreviewState, setEditorDiagnostics, invalidateSource, compileSource, updateLint, canOpenDiagnostic, openDiagnostic, load, loadPreview };
}
