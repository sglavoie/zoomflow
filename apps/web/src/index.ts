import { exportBoardsHtml, exportBoardsZip, exportSourcesZip, renderExportBoards, indexBoards, indexShapeSources, parseSourceRange, lint, type CompileResponse, type ShapeSource, type Diagram, type LintDiagnostic } from '@zoomflow/core';
import { Viewer, prepareExportSvg, rasterizeSvg, offlineViewerScript, offlineViewerStyle, setupViewport, type RenderBoard } from '@zoomflow/viewer';
import { examples } from './examples';
import { setupExamplePicker } from './example-picker';
import './style.css';
import { SourceEditor, compilerDiagnostics, lintDiagnostics, type CompilerDiagnostic } from './editor';
import { diagramFonts } from './fonts';
import { setupReference } from './reference';
import { setupSourceSplit } from './source-split';
import { setupFullscreen } from './fullscreen';
import { setupAiAssistant } from './ai-assistant';
import { setupMobileView } from './mobile-view';
import { projectFileSystem, readDirectoryHandle, readFolderInput } from './project-files';
import type { Diagnostic } from '@codemirror/lint';
import { setupShortcuts } from './shortcuts';

setupShortcuts();
const viewer = new Viewer(document.querySelector<HTMLElement>('#viewer')!);
const viewport = setupViewport(viewer.stage, setupFullscreen(viewer.stage));
const mobileError = document.createElement('div');
mobileError.id = 'mobile-error';
mobileError.hidden = true;
mobileError.innerHTML = '<span role="status"></span><button type="button">Go to error</button>';
viewer.stage.parentElement!.before(mobileError);
const mobileErrorText = mobileError.querySelector('span')!;
const mobileErrorButton = mobileError.querySelector('button')!;
setupReference();
setupSourceSplit();
const showMobileView = setupMobileView(() => viewport.refresh());
document.querySelector('#toggle-reference')!.addEventListener('click', () => showMobileView('preview'));
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
let currentDocumentKey = examples[0].name;
const documentRoutes = new Map<string, { hash: string; trail: unknown }>();
const fileHandles = new Map<string, FileSystemFileHandle>();
let sourceMap: ShapeSource[] = [];
let mappedSource: string | undefined;
let debounce: ReturnType<typeof setTimeout> | undefined;
const errorBanner = document.querySelector<HTMLElement>('#compile-error')!;
const lintSummary = document.querySelector<HTMLElement>('#lint-summary')!;
const draftStatus = document.querySelector<HTMLElement>('#draft-status')!;
const saveFileButton = document.querySelector<HTMLButtonElement>('#save-file')!;
type PickerWindow = Window & {
  showOpenFilePicker?: (options?: object) => Promise<FileSystemFileHandle[]>;
  showSaveFilePicker?: (options?: object) => Promise<FileSystemFileHandle>;
  showDirectoryPicker?: () => Promise<FileSystemDirectoryHandle>;
};
const pickerWindow = window as PickerWindow;
const fileStatus = document.querySelector<HTMLElement>('#file-status')!;
const previewStatus = document.querySelector<HTMLElement>('#preview-status')!;
const missingBacklink = document.querySelector<HTMLInputElement>('#missing-backlink')!;
const boundaryPorts = document.querySelector<HTMLInputElement>('#boundary-ports')!;
const formatButton = document.querySelector<HTMLButtonElement>('#format-source')!;
const formatStatus = document.querySelector<HTMLElement>('#format-status')!;
const activityStatus = document.querySelector<HTMLElement>('#activity-status')!;
const exportStatus = document.querySelector<HTMLElement>('#export-status')!;
const projectDownloadButton = document.querySelector<HTMLButtonElement>('#save-project')!;
const diagnosticsButton = document.querySelector<HTMLButtonElement>('#show-diagnostics')!;
let activeDiagnostics: Diagnostic[] = [];
let externalCompilerError: CompilerDiagnostic | undefined;
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
function setExportStatus(message: string, kind: 'info' | 'error' = 'info') {
  exportStatus.textContent = message;
  exportStatus.dataset.kind = kind;
  exportStatus.hidden = !message;
}
function setFileError(message: string) {
  fileStatus.textContent = message;
  fileStatus.hidden = !message;
  if (message) setActivity(message, 'error');
}
function setEditorDiagnostics(diagnostics: Diagnostic[]) {
  activeDiagnostics = diagnostics;
  const errors = diagnostics.filter((item) => item.severity === 'error').length;
  const warnings = diagnostics.length - errors;
  document.querySelector('#mobile-source')!.textContent = errors ? `Source · ${errors} error${errors === 1 ? '' : 's'}`
    : warnings ? `Source · ${warnings} warning${warnings === 1 ? '' : 's'}` : 'Source';
  editor.diagnostics(diagnostics);
  diagnosticsButton.disabled = diagnostics.length === 0;
  diagnosticsButton.textContent = diagnostics.length ? `Diagnostics (${diagnostics.length})` : 'Diagnostics';
  diagnosticsButton.setAttribute('aria-label', `Review ${diagnostics.length} diagnostic${diagnostics.length === 1 ? '' : 's'}`);
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
  externalCompilerError = undefined;
  mobileError.hidden = true;
  viewer.highlightShapes([]);
  documentExport = undefined;
  exportButton.disabled = true;
  updateExportLabel();
  setPreviewState('updating');
  setActivity('');
  setFileError('');
  setExportStatus('');
  document.querySelector<HTMLButtonElement>('#go-to-error')!.disabled = true;
}
const editor = new SourceEditor(document.querySelector<HTMLElement>('#editor')!, examples[0].source, () => {
  invalidateSource();
  examplePicker.updateCurrent(editor.source);
  clearTimeout(debounce);
  debounce = setTimeout(() => void load(editor.source, documentName, true), 350);
}, () => void highlightSelection(true), () => void formatSource());

const examplePicker = setupExamplePicker(() => editor.source, (source, name, key, reset) => {
  void replaceDocument(source, name, key, reset);
}, (dirty, recoveryAvailable, savePending, hasDraft, downloadRequested) => {
  const handle = fileHandles.get(currentDocumentKey);
  const canSave = Boolean(handle || pickerWindow.showSaveFilePicker);
  saveFileButton.textContent = canSave ? 'Save .d2' : 'Download .d2';
  saveFileButton.title = `${canSave ? 'Save source to a file' : 'Download a source copy; this browser cannot write back to your file'} (⌘S or Ctrl+S)`;
  const recovery = !recoveryAvailable ? 'Browser draft unavailable' : savePending ? 'Saving browser draft…' : 'Browser draft saved';
  const file = downloadRequested ? 'Source download started' : handle && !dirty ? 'Saved to file'
    : dirty ? 'File has unsaved changes' : hasDraft ? 'Save a file copy to keep' : 'Edit to update the preview';
  draftStatus.textContent = !hasDraft && !dirty && !handle && recoveryAvailable && !downloadRequested
    ? file : `${recovery} · ${file}`;
  draftStatus.title = `${draftStatus.textContent}. ${canSave ? 'Save keeps a copy on disk.' : 'Download keeps a separate file copy.'} Browser drafts can be cleared.`;
}, (key) => { editor.forget(key); fileHandles.delete(key); documentRoutes.delete(key); viewport.forget(key); });

function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.addEventListener('click', (event) => event.stopPropagation());
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
projectDownloadButton.addEventListener('click', () => {
  const name = examplePicker.projectName;
  if (!name) return;
  try {
    const { fs, inputPath } = examplePicker.compilation();
    fs[inputPath] = editor.source;
    const filename = `${name.replace(/[/\\]/g, '_')}.zip`;
    download(new Blob([exportSourcesZip(fs)], { type: 'application/zip' }), filename);
    setExportStatus(`Project source download started: ${filename}`);
  } catch (error) { setExportStatus(`Project source download failed: ${String(error)}`, 'error'); }
});

saveFileButton.addEventListener('click', async () => {
  saveFileButton.disabled = true;
  const key = currentDocumentKey;
  const source = editor.source;
  const name = documentName;
  try {
    let handle = fileHandles.get(key);
    if (!handle && pickerWindow.showSaveFilePicker) {
      handle = await pickerWindow.showSaveFilePicker({ suggestedName: name,
        types: [{ description: 'D2 source', accept: { 'text/plain': ['.d2'] } }] });
    }
    if (!handle) {
      document.querySelector<HTMLButtonElement>('#save-source')!.click();
      return;
    }
    const writable = await handle.createWritable();
    try { await writable.write(source); await writable.close(); }
    catch (error) { await writable.abort(); throw error; }
    fileHandles.set(key, handle);
    examplePicker.markDiskSaved(key, source);
    if (currentDocumentKey === key) setActivity(`Saved ${handle.name} to disk.`);
  } catch (error) {
    if (currentDocumentKey === key && !(error instanceof DOMException && error.name === 'AbortError')) setActivity(`Could not save file: ${String(error)}`, 'error');
  } finally { saveFileButton.disabled = false; }
});
window.addEventListener('keydown', (event) => {
  if (event.isComposing || event.altKey || event.shiftKey || !(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== 's') return;
  event.preventDefault();
  if (!event.repeat) saveFileButton.click();
});

async function replaceDocument(source: string, name: string, key: string, reset = false) {
  const route = reset ? undefined : documentRoutes.get(key);
  history.replaceState({ zoomflowTrail: route?.trail }, '', `${location.pathname}${location.search}${route?.hash ?? '#/'}`);
  viewport.setDocument(key, reset);
  documentName = name;
  currentDocumentKey = key;
  projectDownloadButton.hidden = !examplePicker.projectName;
  examplePicker.refresh();
  showMobileView('preview');
  editor.open(key, source, reset);
  invalidateSource();
  errorBanner.hidden = true;
  document.querySelector<HTMLButtonElement>('#go-to-error')!.hidden = true;
  clearTimeout(debounce);
  await load(source, name);
}

async function compileSource(source: string) {
  const [d2, fonts] = await Promise.all([compiler, diagramFonts()]);
  const context = examplePicker.compilation();
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
    formatStatus.textContent = `Formatting failed: ${compilerDiagnostics(error, source, examplePicker.compilation().inputPath).map((item) => item.message).join('\n')}`;
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
  setEditorDiagnostics(lintDiagnostics(result.diagnostics, editor.source, sourceMap, lintDocument.inputPath));
  const errors = result.diagnostics.filter((item) => item.severity === 'error').length;
  const warnings = result.diagnostics.length - errors;
  lintSummary.textContent = errors || warnings ? `${errors} lint error(s), ${warnings} warning(s)` : 'No lint issues';
}
missingBacklink.addEventListener('change', updateLint);
boundaryPorts.addEventListener('change', updateLint);
diagnosticsButton.addEventListener('click', () => {
  const first = activeDiagnostics[0];
  if (!first) return;
  showMobileView('source');
  editor.select(first, true);
  editor.showDiagnostics();
});
mobileErrorButton.addEventListener('click', () => document.querySelector<HTMLButtonElement>('#go-to-error')!.click());
document.querySelector('#go-to-error')!.addEventListener('click', async () => {
  showMobileView('source');
  const foreign = externalCompilerError;
  if (foreign?.filename && foreign.rawRange) {
    const target = examplePicker.selectProjectPath(foreign.filename);
    if (target) {
      await replaceDocument(target.source, target.name, target.key);
      const range = parseSourceRange(foreign.rawRange, target.source, foreign.filename);
      if (range) editor.select(range, true);
      showMobileView('source');
      return;
    }
  }
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
viewer.stage.addEventListener('zf-boardchange', () => {
  // Viewer commits its URL and trail immediately after dispatching this event.
  queueMicrotask(() => {
    documentRoutes.set(currentDocumentKey, { hash: location.hash, trail: history.state?.zoomflowTrail });
    updateExportLabel();
  });
  void highlightSelection(false);
});
viewer.stage.addEventListener('click', (event) => {
  if (mappedSource !== editor.source) return;
  const shape = event.target instanceof Element ? event.target.closest<SVGElement>('[data-shape-id]')
    ?? event.target.closest('a')?.querySelector<SVGElement>('[data-shape-id]') : null;
  const entry = shape && sourceMap.find((item) => item.board === viewer.currentBoard?.id && item.shape === shape.dataset.shapeId);
  if (!entry) return;
  const linked = Boolean(shape.closest('a'));
  if (linked && event.altKey) { event.preventDefault(); event.stopImmediatePropagation(); }
  if (!linked || event.altKey) showMobileView('source');
  editor.select(entry, !linked || event.altKey);
  void highlightSelection(false);
}, { capture: true });
let documentExport: { diagram: Diagram; render: RenderBoard; name: string; diagnostics: LintDiagnostic[] } | undefined;
const exportButton = document.querySelector<HTMLButtonElement>('#export')!;
const exportFormat = document.querySelector<HTMLSelectElement>('#export-format')!;
restorePreference(exportFormat, 'zoomflow.export-format');
function updateExportLabel() {
  const allBoards = exportFormat.value === 'zip' || exportFormat.value === 'html';
  const count = documentExport ? indexBoards(documentExport.diagram).size : 0;
  const formatName = ({ svg: 'SVG', png: 'PNG', zip: 'SVG ZIP', html: 'Interactive HTML' } as Record<string, string>)[exportFormat.value];
  document.querySelector('#export-scope')!.textContent = documentExport
    ? allBoards ? `Entire diagram · ${count} board${count === 1 ? '' : 's'} · ${formatName}`
      : `${viewer.currentBoard?.name ?? 'Root'} · ${formatName}` : 'Compile the current source to export a diagram.';
  document.querySelector('#export-help')!.textContent = exportFormat.value === 'html'
    ? 'Preserves drill-down navigation. Opens offline in any browser.'
    : exportFormat.value === 'zip' ? 'One SVG per board, organized in folders.' : 'Exports only the board currently shown.';
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
      sourceMap = indexShapeSources(compiled.diagram, compiled.graph, source, compiled.inputPath);
      mappedSource = source;
      lintDocument = compiled;
      updateLint();
      errorBanner.hidden = true;
      document.querySelector<HTMLButtonElement>('#go-to-error')!.hidden = true;
      document.querySelector('#compile-error-message')!.textContent = '';
      void highlightSelection(false);
      documentExport = { diagram: compiled.diagram, render, name, diagnostics };
      exportButton.disabled = false;
      updateExportLabel();
      mobileError.hidden = true;
      setPreviewState('ready');
    }
  } catch (error) {
    if (request === generation) {
      const diagnostics = compilerDiagnostics(error, source, examplePicker.compilation().inputPath);
      setEditorDiagnostics(diagnostics);
      lintDocument = undefined;
      lintSummary.textContent = `${diagnostics.length} source error${diagnostics.length === 1 ? '' : 's'}`;
      const first = diagnostics[0];
      const filename = examplePicker.compilation().inputPath;
      externalCompilerError = first.filename && first.filename !== filename ? first : undefined;
      const line = editor.view.state.doc.lineAt(first.from);
      const message = first.message.replace(/^[^:]+:\d+:\d+:\s*/, '');
      document.querySelector('#compile-error-message')!.textContent = externalCompilerError
        ? `Error · ${first.message}` : `Error · Line ${line.number}, column ${first.from - line.from + 1}: ${message}`;
      const goToError = document.querySelector<HTMLButtonElement>('#go-to-error')!;
      goToError.textContent = externalCompilerError ? `Open ${externalCompilerError.filename}` : 'Go to error';
      goToError.title = goToError.textContent;
      goToError.hidden = false;
      goToError.disabled = Boolean(externalCompilerError && !examplePicker.hasProjectPath(externalCompilerError.filename!));
      errorBanner.title = document.querySelector('#compile-error-message')!.textContent!;
      mobileErrorText.textContent = errorBanner.title;
      mobileErrorButton.textContent = goToError.textContent;
      mobileErrorButton.disabled = goToError.disabled;
      mobileError.hidden = false;
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
  setExportStatus(`Preparing ${format.toUpperCase()} download…`);
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
      setExportStatus('Export canceled because the source changed.');
      return;
    }
    download(blob, name);
    const result = warnings.length ? `Download started: ${name}. ${[...new Set(warnings)].join(' ')}` : `Download started: ${name}`;
    setActivity(result, warnings.length > 0 ? 'error' : 'info');
    setExportStatus(result, warnings.length > 0 ? 'error' : 'info');
  } catch (error) {
    const message = `Export failed: ${String(error)}`;
    setActivity(message, 'error');
    setExportStatus(message, 'error');
  }
  finally { exportButton.disabled = !documentExport || mappedSource !== editor.source; }
});
async function openFile(file: File, handle?: FileSystemFileHandle) {
  try {
    if (!/\.d2$/i.test(file.name)) throw new Error('Choose a .d2 file.');
    const source = await file.text();
    setFileError('');
    const key = examplePicker.rememberFile(file.name, source);
    if (handle) fileHandles.set(key, handle);
    examplePicker.refresh();
    await replaceDocument(source, file.name, key);
  }
  catch (error) { setFileError(`Could not open file: ${String(error)}`); }
}
const fileInput = document.querySelector<HTMLInputElement>('#file')!;
fileInput.addEventListener('click', async (event) => {
  if (!pickerWindow.showOpenFilePicker) return;
  event.preventDefault();
  try {
    const [handle] = await pickerWindow.showOpenFilePicker({ types: [{ description: 'D2 source', accept: { 'text/plain': ['.d2'] } }] });
    if (handle) await openFile(await handle.getFile(), handle);
  } catch (error) {
    if (!(error instanceof DOMException && error.name === 'AbortError')) setFileError(`Could not open file: ${String(error)}`);
  }
});
fileInput.addEventListener('change', () => {
  const file = fileInput.files?.[0];
  fileInput.value = '';
  if (file) void openFile(file);
});
async function openFolder(folder: { name: string; files: { path: string; source: string }[];
  handles?: Record<string, FileSystemFileHandle> }) {
  setFileError('');
  const selection = examplePicker.rememberFolder(folder.name, folder.files);
  for (const [path, handle] of Object.entries(folder.handles ?? {})) fileHandles.set(selection.keys[path], handle);
  examplePicker.refresh();
  await replaceDocument(selection.source, selection.name, selection.key);
}
const folderInput = document.querySelector<HTMLInputElement>('#folder')!;
async function chooseFolder() {
  if (!pickerWindow.showDirectoryPicker) { folderInput.click(); return; }
  try { await openFolder(await readDirectoryHandle(await pickerWindow.showDirectoryPicker())); }
  catch (error) {
    if (!(error instanceof DOMException && error.name === 'AbortError')) setFileError(`Could not open folder: ${String(error)}`);
  }
}
document.querySelector<HTMLButtonElement>('#open-folder')!.addEventListener('click', () => void chooseFolder());
document.querySelector<HTMLButtonElement>('#open-folder-picker')!.addEventListener('click', () => void chooseFolder());
folderInput.addEventListener('change', async () => {
  const files = folderInput.files;
  try { if (files?.length) await openFolder(await readFolderInput(files)); }
  catch (error) { setFileError(`Could not open folder: ${String(error)}`); }
  finally { folderInput.value = ''; }
});
let dropHint: ReturnType<typeof setTimeout> | undefined;
document.addEventListener('dragover', (event) => {
  if (!event.dataTransfer?.types.includes('Files')) return;
  event.preventDefault();
  document.body.classList.add('file-drop-active');
  clearTimeout(dropHint);
  dropHint = setTimeout(() => document.body.classList.remove('file-drop-active'), 160);
});
document.addEventListener('drop', (event) => {
  if (!event.dataTransfer?.files.length) return;
  event.preventDefault();
  clearTimeout(dropHint);
  document.body.classList.remove('file-drop-active');
  const file = event.dataTransfer?.files[0];
  if (file) void openFile(file);
});
window.addEventListener('pagehide', () => { clearTimeout(debounce); clearTimeout(previewTimer); ai?.dispose(); examplePicker.flush(); ++generation; editor.destroy(); viewer.destroy(); void compiler.then((d2) => d2.dispose()); });
documentName = examplePicker.initial.name;
currentDocumentKey = examplePicker.initial.key;
projectDownloadButton.hidden = !examplePicker.projectName;
viewport.setDocument(currentDocumentKey);
editor.open(examplePicker.initial.key, examplePicker.initial.source);
examplePicker.refresh();
clearTimeout(debounce);
void load(editor.source, documentName);
