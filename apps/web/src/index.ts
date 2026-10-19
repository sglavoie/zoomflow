import { exportBoardsHtml, exportBoardsZip, renderExportBoards, indexShapeSources, lint, type CompileResponse, type ShapeSource, type Diagram, type LintDiagnostic } from '@zoomflow/core';
import { Viewer, prepareExportSvg, rasterizeSvg, offlineViewerScript, offlineViewerStyle, setupViewport, type RenderBoard } from '@zoomflow/viewer';
import { examples } from './examples';
import { setupExamplePicker } from './example-picker';
import standardLibrary from '../../../stdlib/zoomflow.d2?raw';
import './style.css';
import { SourceEditor, compilerDiagnostics, lintDiagnostics } from './editor';
import { diagramFonts } from './fonts';
import { setupReference } from './reference';
import { setupSourceSplit } from './source-split';
import { setupFullscreen } from './fullscreen';
import { setupAiAssistant } from './ai-assistant';
import type { Diagnostic } from '@codemirror/lint';

const viewer = new Viewer(document.querySelector<HTMLElement>('#viewer')!);
setupViewport(viewer.stage, setupFullscreen(viewer.stage));
setupReference();
setupSourceSplit();
const moreToggle = document.querySelector<HTMLButtonElement>('#header-more-toggle')!;
const moreContent = document.querySelector<HTMLElement>('#header-more-content')!;
const more = document.querySelector<HTMLElement>('#header-more')!;
function setMoreOpen(open: boolean) {
  moreContent.hidden = !open;
  moreToggle.setAttribute('aria-expanded', String(open));
}
moreToggle.addEventListener('click', () => setMoreOpen(Boolean(moreContent.hidden)));
document.addEventListener('click', (event) => { if (event.target instanceof Node && !more.contains(event.target)) setMoreOpen(false); });
more.addEventListener('focusout', (event) => { if (event.relatedTarget instanceof Node && !more.contains(event.relatedTarget)) setMoreOpen(false); });
more.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && !moreContent.hidden) {
    event.preventDefault(); event.stopPropagation(); setMoreOpen(false); moreToggle.focus();
  }
});
function restorePreference(select: HTMLSelectElement, key: string) {
  try {
    const saved = localStorage.getItem(key);
    if ([...select.options].some((option) => option.value === saved)) select.value = saved!;
  } catch { /* Preferences are optional when storage is unavailable. */ }
  select.addEventListener('change', () => { try { localStorage.setItem(key, select.value); } catch { /* Optional storage. */ } });
}
const theme = document.querySelector<HTMLSelectElement>('#theme')!;
restorePreference(theme, 'zoomflow.theme');
const media = matchMedia('(prefers-color-scheme: dark)');
function updateTheme() {
  document.documentElement.dataset.theme = theme.value === 'system'
    ? media.matches ? 'dark' : 'light' : theme.value;
  viewer.setTheme(document.documentElement.dataset.theme === 'dark');
}
theme.addEventListener('change', updateTheme);
media.addEventListener('change', updateTheme);
updateTheme();

// The pinned browser entry creates and owns D2's WASM worker. Import it lazily
// so the shell and loading state paint before the compiler is downloaded.
const compiler = import('@d2lang/d2').then(({ D2 }) => new D2());
let generation = 0;
let documentRevision = 0;
let ai: ReturnType<typeof setupAiAssistant> | undefined;
let documentName = examples[0].name;
let sourceMap: ShapeSource[] = [];
let mappedSource: string | undefined;
let debounce: ReturnType<typeof setTimeout> | undefined;
const errorBanner = document.querySelector<HTMLElement>('#compile-error')!;
const lintSummary = document.querySelector<HTMLElement>('#lint-summary')!;
const draftStatus = document.querySelector<HTMLElement>('#draft-status')!;
const previewStatus = document.querySelector<HTMLElement>('#preview-status')!;
const missingBacklink = document.querySelector<HTMLInputElement>('#missing-backlink')!;
const boundaryPorts = document.querySelector<HTMLInputElement>('#boundary-ports')!;
const formatButton = document.querySelector<HTMLButtonElement>('#format-source')!;
const formatStatus = document.querySelector<HTMLElement>('#format-status')!;
const activityStatus = document.querySelector<HTMLElement>('#activity-status')!;
const diagnosticsButton = document.querySelector<HTMLButtonElement>('#show-diagnostics')!;
let activeDiagnostics: Diagnostic[] = [];
let previewTimer: ReturnType<typeof setTimeout> | undefined;
function setPreviewState(state: 'loading' | 'updating' | 'ready' | 'error') {
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
    ready: 'Preview ready', error: 'Preview out of date' }[state];
  if (state === 'error') viewer.stage.dataset.previewState = 'stale';
  else delete viewer.stage.dataset.previewState;
}
function setActivity(message: string, kind: 'info' | 'error' = 'info') {
  activityStatus.textContent = message;
  activityStatus.dataset.kind = kind;
  activityStatus.setAttribute('role', kind === 'error' ? 'alert' : 'status');
  activityStatus.hidden = !message;
}
function setEditorDiagnostics(diagnostics: Diagnostic[]) {
  activeDiagnostics = diagnostics;
  editor.diagnostics(diagnostics);
  diagnosticsButton.disabled = diagnostics.length === 0;
  diagnosticsButton.textContent = diagnostics.length ? `Review ${diagnostics.length} diagnostic${diagnostics.length === 1 ? '' : 's'}` : 'Review diagnostics';
}
let lintDocument: CompileResponse | undefined;
function invalidateSource() {
  // Invalidate immediately, including requests still awaiting WASM/render startup.
  ++generation;
  ++documentRevision;
  ai?.sourceChanged();
  viewer.setBusy(true);
  formatStatus.hidden = true;
  viewer.cancelPendingRender();
  sourceMap = [];
  lintDocument = undefined;
  setEditorDiagnostics([]);
  viewer.highlightShapes([]);
  documentExport = undefined;
  exportButton.disabled = true;
  setPreviewState('updating');
  setActivity('');
  document.querySelector<HTMLButtonElement>('#go-to-error')!.disabled = true;
}
const editor = new SourceEditor(document.querySelector<HTMLElement>('#editor')!, examples[0].source, () => {
  invalidateSource();
  examplePicker.updateCurrent(editor.source);
  clearTimeout(debounce);
  debounce = setTimeout(() => void load(editor.source, documentName, true), 350);
}, () => void highlightSelection(true), () => void formatSource());

const examplePicker = setupExamplePicker(() => editor.source, (source, name, key, reset) => {
  // Example changes start at their overview; live edits still preserve the route.
  history.replaceState(null, '', `${location.pathname}${location.search}#/`);
  void replaceDocument(source, name, key, reset);
}, (dirty, recoveryAvailable, savePending, hasDraft, downloadRequested) => {
  draftStatus.textContent = downloadRequested ? 'Source download started'
    : !recoveryAvailable ? 'Browser storage unavailable · download source'
      : savePending ? 'Saving browser draft…'
        : dirty || hasDraft ? 'Browser draft saved' : '';
  draftStatus.title = recoveryAvailable
    ? 'Browser drafts can be cleared. Download the source to keep a copy outside this browser.'
    : 'Browser draft recovery is unavailable. Download the source to keep your changes.';
}, (key) => editor.forget(key));

function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
document.querySelector<HTMLButtonElement>('#save-source')!.addEventListener('click', () => {
  const name = documentName.replace(/[/\\]/g, '_').replace(/\.d2$/i, '') + '.d2';
  download(new Blob([editor.source], { type: 'text/plain;charset=utf-8' }), name);
  examplePicker.markDownloadRequested();
  setActivity(`Source download started: ${name}`);
});

async function replaceDocument(source: string, name: string, key: string, reset = false) {
  documentName = name;
  editor.open(key, source, reset);
  invalidateSource();
  errorBanner.hidden = true;
  clearTimeout(debounce);
  await load(source, name);
}

async function compileSource(source: string) {
  const [d2, fonts] = await Promise.all([compiler, diagramFonts()]);
  const padValue = new URLSearchParams(location.search).get('pad');
  const pad = padValue === null ? 100 : Number(padValue);
  return d2.compile({ fs: { index: source, 'zoomflow.d2': standardLibrary } }, {
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
  formatStatus.textContent = 'Formatting…';
  formatStatus.hidden = false;
  try {
    const compiled = mappedSource === source && lintDocument ? lintDocument : await compileSource(source);
    // Edits or opening another file invalidate this request, even after undo.
    if (editor.view.state.doc !== document || documentRevision !== revision) return;
    const formatted = compiled.fs[compiled.inputPath];
    if (typeof formatted !== 'string') throw new Error('D2 did not return formatted source.');
    formatStatus.textContent = editor.format(formatted) ? 'Source formatted.' : 'Source is already formatted.';
    formatStatus.hidden = false;
  } catch (error) {
    if (editor.view.state.doc !== document || documentRevision !== revision) return;
    formatStatus.textContent = `Formatting failed: ${compilerDiagnostics(error, source).map((item) => item.message).join('\n')}`;
    formatStatus.hidden = false;
  } finally { formatButton.disabled = false; }
}
formatButton.addEventListener('click', () => void formatSource());
ai = setupAiAssistant(
  () => ({ source: editor.source, name: documentName, board: viewer.currentBoard?.id ?? 'root', revision: documentRevision }),
  async (source) => { await compileSource(source); },
  (source) => { editor.format(source); },
  (message, kind) => setActivity(message, kind),
  () => editor.undo(),
);

function updateLint() {
  if (!lintDocument || mappedSource !== editor.source) return;
  const result = lint(lintDocument, { missingBacklink: missingBacklink.checked, boundaryPorts: boundaryPorts.checked });
  setEditorDiagnostics(lintDiagnostics(result.diagnostics, editor.source, sourceMap));
  const errors = result.diagnostics.filter((item) => item.severity === 'error').length;
  const warnings = result.diagnostics.length - errors;
  lintSummary.textContent = errors || warnings ? `${errors} lint error(s), ${warnings} warning(s)` : 'No lint issues';
}
missingBacklink.addEventListener('change', updateLint);
boundaryPorts.addEventListener('change', updateLint);
diagnosticsButton.addEventListener('click', () => {
  const first = activeDiagnostics[0];
  if (!first) return;
  editor.select(first, true);
  editor.showDiagnostics();
});
document.querySelector('#go-to-error')!.addEventListener('click', () => {
  if (activeDiagnostics[0]) editor.select(activeDiagnostics[0], true);
});

async function highlightSelection(navigate: boolean) {
  if (mappedSource !== editor.source) return;
  const { from, to, empty } = editor.selection;
  const matches = sourceMap.filter((entry) => empty
    ? from >= entry.from && from < entry.to : from < entry.to && to > entry.from);
  const current = viewer.currentBoard?.id;
  const target = matches.find((entry) => entry.board === current) ?? matches[0];
  if (navigate && target && target.board !== current) await viewer.navigate(target.board);
  viewer.highlightShapes(matches.filter((entry) => entry.board === viewer.currentBoard?.id).map((entry) => entry.shape));
}
viewer.stage.addEventListener('zf-boardchange', () => void highlightSelection(false));
viewer.stage.addEventListener('click', (event) => {
  if (mappedSource !== editor.source) return;
  const shape = event.target instanceof Element ? event.target.closest<SVGElement>('[data-shape-id]')
    ?? event.target.closest('a')?.querySelector<SVGElement>('[data-shape-id]') : null;
  const entry = shape && sourceMap.find((item) => item.board === viewer.currentBoard?.id && item.shape === shape.dataset.shapeId);
  if (!entry) return;
  const linked = Boolean(shape.closest('a'));
  if (linked && event.altKey) { event.preventDefault(); event.stopImmediatePropagation(); }
  editor.select(entry, !linked || event.altKey);
  void highlightSelection(false);
}, { capture: true });
let documentExport: { diagram: Diagram; render: RenderBoard; name: string; diagnostics: LintDiagnostic[] } | undefined;
const exportButton = document.querySelector<HTMLButtonElement>('#export')!;
const exportFormat = document.querySelector<HTMLSelectElement>('#export-format')!;
restorePreference(exportFormat, 'zoomflow.export-format');
function updateExportLabel() {
  exportButton.textContent = ({ svg: 'Download SVG', png: 'Download PNG', zip: 'Download SVG ZIP',
    html: 'Download HTML' } as Record<string, string>)[exportFormat.value] ?? 'Download export';
}
exportFormat.addEventListener('change', updateExportLabel);
updateExportLabel();
async function load(source: string, name: string, preserveViewport = false) {
  const request = ++generation;
  viewer.setBusy(true);
  viewer.setMessage('');
  setPreviewState(viewer.stage.querySelector('svg') ? 'updating' : 'loading');
  try {
    const d2 = await compiler;
    const compiled = await compileSource(source);
    if (request !== generation) return;
    // D2 registers fonts at compile time for both text measurement and rendering.
    // This diagram carries that family into every viewer/export render call.
    const render: RenderBoard = (target) => d2.render(compiled.diagram, {
      ...compiled.renderOptions, target, noXMLTag: true,
    });
    const diagnostics = lint(compiled).diagnostics;
    await viewer.setDocument(compiled.diagram, render, diagnostics, preserveViewport);
    if (request === generation) {
      sourceMap = indexShapeSources(compiled.diagram, compiled.graph, source);
      mappedSource = source;
      lintDocument = compiled;
      updateLint();
      errorBanner.hidden = true;
      document.querySelector('#compile-error-message')!.textContent = '';
      void highlightSelection(false);
      documentExport = { diagram: compiled.diagram, render, name, diagnostics };
      exportButton.disabled = false;
      setPreviewState('ready');
    }
  } catch (error) {
    if (request === generation) {
      const diagnostics = compilerDiagnostics(error, source);
      setEditorDiagnostics(diagnostics);
      lintDocument = undefined;
      lintSummary.textContent = `${diagnostics.length} source error${diagnostics.length === 1 ? '' : 's'}`;
      const first = diagnostics[0];
      const line = editor.view.state.doc.lineAt(first.from);
      const message = first.message.replace(/^index:\d+:\d+:\s*/, '');
      document.querySelector('#compile-error-message')!.textContent = `Error · Line ${line.number}, column ${first.from - line.from + 1}: ${message}`;
      document.querySelector<HTMLButtonElement>('#go-to-error')!.disabled = false;
      errorBanner.hidden = false;
      viewer.setMessage('');
      setPreviewState('error');
    }
  } finally {
    if (request === generation) viewer.setBusy(false);
  }
}

exportButton.addEventListener('click', async () => {
  const loaded = documentExport;
  const board = viewer.currentBoard;
  if (!loaded || !board) return;
  const exportRevision = generation;
  exportButton.disabled = true;
  const format = exportFormat.value;
  setActivity(`Preparing ${format.toUpperCase()} download…`);
  const dark = document.documentElement.dataset.theme === 'dark';
  const warnings: string[] = [];
  const prepare = async (target: string) => {
    const result = await prepareExportSvg(await loaded.render(target), dark);
    warnings.push(...result.warnings);
    return result.svg;
  };
  try {
    let blob: Blob;
    let name = loaded.name.replace(/\.d2$/i, '');
    if (format === 'svg' || format === 'png') {
      const svg = await prepare(board.target);
      blob = format === 'png' ? await rasterizeSvg(svg) : new Blob([svg], { type: 'image/svg+xml' });
      name += `-${board.name === 'Root' ? 'root' : encodeURIComponent(board.name)}.${format}`;
    } else {
      const boards = await renderExportBoards(loaded.diagram, prepare, loaded.diagnostics);
      blob = format === 'zip' ? new Blob([exportBoardsZip(boards)], { type: 'application/zip' })
        : new Blob([exportBoardsHtml(boards, { title: loaded.name, script: offlineViewerScript(),
          style: offlineViewerStyle + (dark ? ':root{color-scheme:dark;--zf-page:#111722;--zf-text:#e4eaf2;--zf-surface:#182231;--zf-border:#8192a466;--zf-muted:#adbbcd}.zf-stage{background:#0a0f25}' : '') })], { type: 'text/html' });
      name += `.${format}`;
    }
    if (exportRevision !== generation || documentExport !== loaded) {
      setActivity('Export canceled because the source changed.');
      return;
    }
    download(blob, name);
    const result = warnings.length ? `Download started: ${name}. ${[...new Set(warnings)].join(' ')}` : `Download started: ${name}`;
    setActivity(result, warnings.length > 0 ? 'error' : 'info');
  } catch (error) {
    const message = `Export failed: ${String(error)}`;
    setActivity(message, 'error');
  }
  finally { exportButton.disabled = !documentExport || mappedSource !== editor.source; }
});
async function openFile(file: File) {
  try {
    const source = await file.text();
    const key = examplePicker.rememberFile(file.name, source);
    await replaceDocument(source, file.name, key);
  }
  catch (error) { setActivity(`Could not open file: ${String(error)}`, 'error'); }
}
document.querySelector<HTMLInputElement>('#file')!.addEventListener('change', (event) => {
  const file = (event.target as HTMLInputElement).files?.[0];
  if (file) void openFile(file);
});
document.addEventListener('dragover', (event) => event.preventDefault());
document.addEventListener('drop', (event) => {
  event.preventDefault();
  const file = event.dataTransfer?.files[0];
  if (file) void openFile(file);
});
window.addEventListener('pagehide', () => { clearTimeout(debounce); clearTimeout(previewTimer); ai?.dispose(); examplePicker.flush(); ++generation; editor.destroy(); viewer.destroy(); void compiler.then((d2) => d2.dispose()); });
documentName = examplePicker.initial.name;
editor.open(examplePicker.initial.key, examplePicker.initial.source);
clearTimeout(debounce);
void load(editor.source, documentName);
