import { exportBoardsHtml, exportBoardsZip, exportSourcesZip, renderExportBoards, indexBoards, indexShapeSources, parseSourceRange, lint, type CompileResponse, type ShapeSource, type Diagram, type LintDiagnostic } from '@zoomflow/core';
import { Viewer, prepareExportSvg, rasterizeSvg, offlineViewerScript, offlineViewerStyle, viewerStyle, setupViewport, type RenderBoard } from '@zoomflow/viewer';
import { examples } from './examples';
import { setupExamplePicker } from './example-picker';
import './style.css';
import { SourceEditor } from './editor';
import { compilerDiagnostics, lintDiagnostics, type SourceDiagnostic } from './diagnostics';
import { createCompiler, CompilerStartupError } from './compiler';
import { createPreviewQueue } from './preview-queue';
import { setupReference } from './reference';
import { setupSourceSplit } from './source-split';
import { setupFullscreen } from './fullscreen';
import { setupAiAssistant } from './ai-assistant';
import { setupMobileView } from './mobile-view';
import { projectFileSystem, readDirectoryHandle, readFolderInput } from './project-files';
import { setupShortcuts } from './shortcuts';
import { setupCanvasGuidance } from './canvas-guidance';
import { setupFlowBuilder } from './flow-builder';

const canvasStyle = document.createElement('style');
canvasStyle.textContent = viewerStyle;
document.head.prepend(canvasStyle);
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
const compiler = createCompiler();
const previewQueue = createPreviewQueue();
const engineNotice = document.querySelector<HTMLElement>('#engine-notice')!;
const engineMessage = document.querySelector<HTMLElement>('#engine-message')!;
const retryEngine = document.querySelector<HTMLButtonElement>('#retry-engine')!;
retryEngine.addEventListener('click', () => {
  if (retryEngine.dataset.restart === 'true') {
    compiler.restart();
    previewQueue.restart();
  }
  clearTimeout(debounce);
  invalidateSource();
  void load(editor.source, documentName, true);
});
let generation = 0;
let documentRevision = 0;
let ai: ReturnType<typeof setupAiAssistant> | undefined;
let flowBuilder: ReturnType<typeof setupFlowBuilder> | undefined;
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
const revealButton = document.querySelector<HTMLButtonElement>('#reveal-source')!;
let activeDiagnostics: SourceDiagnostic[] = [];
let activityTimer: ReturnType<typeof setTimeout> | undefined;
let formatTimer: ReturnType<typeof setTimeout> | undefined;
let previewTimer: ReturnType<typeof setTimeout> | undefined;
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
function setActivity(message: string, kind: 'info' | 'error' = 'info') {
  clearTimeout(activityTimer);
  activityStatus.textContent = message;
  activityStatus.title = message;
  activityStatus.dataset.kind = kind;
  activityStatus.setAttribute('role', kind === 'error' ? 'alert' : 'status');
  activityStatus.hidden = !message;
  if (message && kind === 'info' && !message.endsWith('…')) activityTimer = setTimeout(() => { activityStatus.hidden = true; }, 4000);
}
function setFormatStatus(message: string, kind: 'info' | 'error' = 'info') {
  clearTimeout(formatTimer);
  formatStatus.textContent = message;
  formatStatus.title = message;
  formatStatus.dataset.kind = kind;
  formatStatus.setAttribute('role', kind === 'error' ? 'alert' : 'status');
  formatStatus.hidden = !message;
  if (message && kind === 'info' && !message.endsWith('…')) formatTimer = setTimeout(() => { formatStatus.hidden = true; }, 4000);
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
function setEditorDiagnostics(diagnostics: SourceDiagnostic[]) {
  activeDiagnostics = diagnostics;
  const errors = diagnostics.filter((item) => item.severity === 'error').length;
  const warnings = diagnostics.length - errors;
  document.querySelector('#mobile-source')!.textContent = errors ? `Source · ${errors} error${errors === 1 ? '' : 's'}`
    : warnings ? `Source · ${warnings} warning${warnings === 1 ? '' : 's'}` : 'Source';
  editor.diagnostics(diagnostics, examplePicker.compilation().inputPath, documentName, canOpenDiagnostic, (item) => void openDiagnostic(item));
  diagnosticsButton.disabled = diagnostics.length === 0;
  diagnosticsButton.textContent = diagnostics.length ? `Diagnostics (${diagnostics.length})` : 'Diagnostics';
  diagnosticsButton.setAttribute('aria-label', `Review ${diagnostics.length} diagnostic${diagnostics.length === 1 ? '' : 's'}`);
}
let lintDocument: CompileResponse | undefined;
function invalidateSource() {
  flowBuilder?.refresh();
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
  exportButton.disabled = true;
  updateExportLabel();
  setPreviewState('updating');
  setActivity('');
  setFileError('');
  setExportStatus('');
  document.querySelector<HTMLButtonElement>('#go-to-error')!.disabled = true;
  viewer.stage.dispatchEvent(new Event('zf-sourcechange'));
}
const editor = new SourceEditor(document.querySelector<HTMLElement>('#editor')!, examples[0].source, () => {
  invalidateSource();
  examplePicker.updateCurrent(editor.source);
  clearTimeout(debounce);
  debounce = setTimeout(() => void load(editor.source, documentName, true), 350);
}, () => void highlightSelection(false), () => void formatSource(), () => void revealSelection());

const examplePicker = setupExamplePicker(() => editor.source, (source, name, key, reset) => {
  void replaceDocument(source, name, key, reset);
}, (dirty, recoveryAvailable, savePending, hasDraft, downloadRequested, identity) => {
  const handle = fileHandles.get(identity.key);
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
  document.querySelector('#recovery-info')!.textContent = recoveryAvailable
    ? 'Edits are backed up in this browser. Save a disk copy to keep them; browser storage can be cleared.'
    : 'Browser recovery is unavailable. Save or download a disk copy to keep your edits.';
  document.title = `${dirty ? '• ' : ''}${identity.name} — Zoomflow`;
  document.querySelector<HTMLElement>('#document-unsaved')!.hidden = !dirty;
  document.querySelector('#example-picker > summary')!.setAttribute('aria-label', dirty ? 'Choose a diagram — unsaved changes' : 'Choose a diagram');
}, (key) => { editor.forget(key); fileHandles.delete(key); documentRoutes.delete(key); viewport.forget(key); }, (key) => {
  const restoreEditor = editor.checkpoint(key);
  const restoreViewport = viewport.checkpoint(key);
  const handle = fileHandles.get(key);
  const route = documentRoutes.get(key);
  return () => {
    restoreEditor(); restoreViewport();
    if (handle) fileHandles.set(key, handle);
    if (route) documentRoutes.set(key, route);
  };
});

flowBuilder = setupFlowBuilder({
  read: () => ({ source: editor.source, name: documentName }),
  create: (source, name) => {
    const key = examplePicker.rememberFile(name, source, '');
    void replaceDocument(source, name, key);
    showMobileView('preview');
  },
  update: source => {
    editor.replaceSource(source);
    showMobileView('preview');
  },
});

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
  let saving: ReturnType<typeof setTimeout> | undefined;
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
    saving = setTimeout(() => { if (currentDocumentKey === key) setActivity('Saving file…'); }, 700);
    const writable = await handle.createWritable();
    try { await writable.write(source); await writable.close(); }
    catch (error) { await writable.abort(); throw error; }
    const saved = examplePicker.markDiskSaved(key, source, handle.name);
    if (!saved) return; // The draft may have been removed while the file dialog was open.
    fileHandles.set(saved.key, handle);
    if (currentDocumentKey === key) {
      if (saved.key !== key) {
        editor.copyDocument(saved.key);
        viewport.copyDocument(saved.key);
        const route = documentRoutes.get(key);
        if (route) documentRoutes.set(saved.key, route);
      }
      currentDocumentKey = saved.key;
      documentName = saved.name;
      // Save identity changes do not invalidate compiled geometry or editor history.
      examplePicker.refresh();
      setActivity('');
    }
  } catch (error) {
    if (currentDocumentKey === key && !(error instanceof DOMException && error.name === 'AbortError')) setActivity(`Could not save file: ${String(error)}`, 'error');
  } finally {
    clearTimeout(saving);
    if (currentDocumentKey === key && activityStatus.textContent === 'Saving file…') setActivity('');
    saveFileButton.disabled = false;
  }
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
  editor.open(key, source, reset);
  invalidateSource();
  errorBanner.hidden = true;
  document.querySelector<HTMLButtonElement>('#go-to-error')!.hidden = true;
  clearTimeout(debounce);
  await load(source, name);
}

async function compileSource(source: string) {
  const context = examplePicker.compilation();
  const { d2, fonts } = await compiler.get();
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
    setFormatStatus(`Formatting failed: ${compilerDiagnostics(error, source, examplePicker.compilation().inputPath).map((item) => item.message).join('\n')}`, 'error');
  } finally { formatButton.disabled = false; }
}
formatButton.addEventListener('click', () => void formatSource());
document.querySelector('#clear-source')!.addEventListener('click', () => {
  if (editor.replaceSource('', 'delete.clear')) setActivity('Source cleared. Undo with ⌘Z / Ctrl+Z.');
  editor.view.focus();
});
ai = setupAiAssistant(
  () => ({ source: editor.source, name: documentName, board: viewer.currentBoard?.id ?? 'root', revision: documentRevision }),
  async (source) => { await compileSource(source); },
  (source) => editor.applyAi(source),
  (message, kind) => setActivity(message, kind),
  () => editor.undo(),
  () => { showMobileView('source'); editor.revealAiChange(); },
  () => editor.clearAiHighlights(),
);

function updateLint() {
  if (!lintDocument || mappedSource !== editor.source) return;
  const result = lint(lintDocument, { missingBacklink: missingBacklink.checked, boundaryPorts: boundaryPorts.checked });
  setEditorDiagnostics(lintDiagnostics(result.diagnostics, editor.source, sourceMap, lintDocument.inputPath));
  const errors = result.diagnostics.filter((item) => item.severity === 'error').length;
  const warnings = result.diagnostics.length - errors;
  lintSummary.textContent = errors || warnings ? `${errors} lint error(s), ${warnings} warning(s)` : 'No lint issues';
  lintSummary.dataset.empty = String(!errors && !warnings);
}
missingBacklink.addEventListener('change', updateLint);
boundaryPorts.addEventListener('change', updateLint);
function canOpenDiagnostic(item: SourceDiagnostic) {
  if (item.filename === examplePicker.compilation().inputPath) return Boolean(item.range);
  const text = item.filename && examplePicker.compilation().fs[item.filename];
  return typeof text === 'string' && Boolean(item.rawRange && parseSourceRange(item.rawRange, text, item.filename));
}
async function openDiagnostic(item: SourceDiagnostic) {
  if (!canOpenDiagnostic(item)) return;
  showMobileView('source');
  if (item.filename === examplePicker.compilation().inputPath) {
    if (item.range) editor.select(item.range, true);
    return;
  }
  const target = examplePicker.selectProjectPath(item.filename!);
  if (!target || !item.rawRange) return;
  const key = target.key;
  await replaceDocument(target.source, target.name, key);
  // A second navigation during compilation must not move the new document's cursor.
  if (currentDocumentKey !== key || editor.source !== target.source) return;
  const range = parseSourceRange(item.rawRange, target.source, item.filename);
  if (range) editor.select(range, true);
}
diagnosticsButton.addEventListener('click', () => {
  showMobileView('source');
  editor.showDiagnostics();
});
mobileErrorButton.addEventListener('click', () => document.querySelector<HTMLButtonElement>('#go-to-error')!.click());
document.querySelector('#go-to-error')!.addEventListener('click', () => {
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
  showMobileView('preview');
  viewport.reveal([...viewer.stage.querySelectorAll<SVGGraphicsElement>('.zf-source-selected')]);
  viewer.stage.focus({ preventScroll: true });
}
revealButton.addEventListener('click', () => void revealSelection());
viewer.stage.addEventListener('zf-boardchange', () => {
  // Viewer commits its URL and trail immediately after dispatching this event.
  queueMicrotask(() => {
    documentRoutes.set(currentDocumentKey, { hash: location.hash, trail: history.state?.zoomflowTrail });
    updateExportLabel();
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
  if (!linked || event.altKey) showMobileView('source');
  editor.select(entry, !linked || event.altKey);
  void highlightSelection(false);
}
viewer.stage.addEventListener('click', selectShape, { capture: true });
viewer.stage.addEventListener('keydown', selectShape, { capture: true });
setupCanvasGuidance(viewer.stage, viewport.setGuidance, () => sourceMap.length > 0 && mappedSource === editor.source,
  () => {
    if (document.body.classList.contains('diagram-fullscreen')) document.querySelector<HTMLButtonElement>('.zf-fullscreen-toggle')!.click();
    showMobileView('source'); editor.view.focus();
  });
let documentExport: { diagram: Diagram; render: RenderBoard; name: string; diagnostics: LintDiagnostic[] } | undefined;
const exportButton = document.querySelector<HTMLButtonElement>('#export')!;
const exportChoices = document.querySelector<HTMLFieldSetElement>('#export-format')!;
const exportFormat = { get value() { return exportChoices.querySelector<HTMLInputElement>('input:checked')!.value; } };
let explicitExportFormat = false;
try {
  const saved = localStorage.getItem('zoomflow.export-format');
  const choice = [...exportChoices.querySelectorAll<HTMLInputElement>('input')].find(input => input.value === saved);
  if (choice) { choice.checked = true; explicitExportFormat = true; }
} catch { /* Exporting works without stored preferences. */ }
function updateExportLabel() {
  const count = documentExport ? indexBoards(documentExport.diagram).size : 0;
  if (documentExport && !explicitExportFormat) {
    exportChoices.querySelector<HTMLInputElement>(`input[value="${count > 1 ? 'html' : 'svg'}"]`)!.checked = true;
  }
  const allBoards = exportFormat.value === 'zip' || exportFormat.value === 'html';
  const formatName = ({ svg: 'SVG', png: 'PNG', zip: 'SVG ZIP', html: 'Interactive HTML' } as Record<string, string>)[exportFormat.value];
  document.querySelector('#export-scope')!.textContent = documentExport
    ? allBoards ? `Entire diagram · ${count} board${count === 1 ? '' : 's'} · ${formatName}`
      : `Current board: ${viewer.currentBoard?.name ?? 'Root'} · ${formatName}` : 'Compile the current source to export a diagram.';
  exportButton.textContent = ({ svg: 'Download SVG', png: 'Download PNG', zip: 'Download SVG ZIP',
    html: 'Download HTML' } as Record<string, string>)[exportFormat.value] ?? 'Download export';
}
function rememberExportFormat() {
  explicitExportFormat = true;
  try { localStorage.setItem('zoomflow.export-format', exportFormat.value); } catch { /* Optional preference. */ }
  updateExportLabel();
}
exportChoices.addEventListener('change', rememberExportFormat);
exportChoices.addEventListener('click', (event) => {
  // Clicking the automatically selected format is still an explicit choice.
  if (event.target instanceof HTMLInputElement && event.target.checked) rememberExportFormat();
});
updateExportLabel();
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
  engineNotice.hidden = true;
  retryEngine.hidden = true;
  retryEngine.dataset.restart = 'false';
  retryEngine.textContent = 'Retry preview';
  const startupTimer = !compiler.ready ? setTimeout(() => {
    if (request !== generation) return;
    engineNotice.setAttribute('role', 'status');
    engineMessage.textContent = 'Loading the diagram engine… The first download can take a moment. You can keep editing.';
    engineNotice.hidden = false;
  }, 1200) : undefined;
  try {
    const { d2 } = await compiler.get();
    clearTimeout(startupTimer);
    if (request !== generation) return;
    engineNotice.hidden = true;
    slowTimer = setTimeout(() => {
      if (attempt !== previewAttempt) return;
      engineNotice.setAttribute('role', 'status');
      engineMessage.textContent = 'The preview is taking longer than usual. You can keep editing, wait, or restart the engine to preview your latest source.';
      engineNotice.hidden = false;
      retryEngine.textContent = 'Restart preview';
      retryEngine.dataset.restart = 'true';
      retryEngine.hidden = false;
    }, 15_000);
    const compiled = await compileSource(source);
    if (request !== generation) return;
    // D2 registers fonts at compile time for both text measurement and rendering.
    // This diagram carries that family into every viewer/export render call.
    const render: RenderBoard = (target) => d2.render(compiled.diagram, {
      ...compiled.renderOptions, target, noXMLTag: true,
    });
    const diagnostics = lint(compiled).diagnostics;
    const compiledSources = indexShapeSources(compiled.diagram, compiled.graph, source, compiled.inputPath);
    viewer.setSourceShapes(compiledSources);
    await viewer.setDocument(compiled.diagram, render, diagnostics, preserveViewport);
    if (request === generation) {
      sourceMap = compiledSources;
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
      if (error instanceof CompilerStartupError) {
        setEditorDiagnostics([]);
        errorBanner.hidden = true;
        document.querySelector<HTMLButtonElement>('#go-to-error')!.hidden = true;
        mobileError.hidden = true;
        lintSummary.textContent = '';
        engineNotice.setAttribute('role', 'alert');
        engineMessage.textContent = 'The diagram engine could not start. Check your connection and retry. Your source is preserved.';
        engineNotice.hidden = false;
        retryEngine.hidden = false;
        setPreviewState('unavailable');
        return;
      }
      const diagnostics = compilerDiagnostics(error, source, examplePicker.compilation().inputPath);
      setEditorDiagnostics(diagnostics);
      lintDocument = undefined;
      lintSummary.textContent = `${diagnostics.length} source error${diagnostics.length === 1 ? '' : 's'}`;
      const first = diagnostics[0];
      const filename = examplePicker.compilation().inputPath;
      const externalCompilerError = first.filename && first.filename !== filename ? first : undefined;
      const message = first.message.replace(/^[^:]+:\d+:\d+:\s*/, '');
      document.querySelector('#compile-error-message')!.textContent = externalCompilerError
        ? `Error · ${first.message}` : first.range ? `Error · Line ${first.line}, column ${first.column}: ${message}` : `Error · Source location unavailable: ${message}`;
      const goToError = document.querySelector<HTMLButtonElement>('#go-to-error')!;
      goToError.textContent = externalCompilerError ? `Open ${externalCompilerError.filename}` : 'Go to error';
      goToError.title = goToError.textContent;
      goToError.hidden = false;
      goToError.disabled = !canOpenDiagnostic(first);
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
    clearTimeout(startupTimer);
    clearTimeout(slowTimer);
    if (attempt === previewAttempt && retryEngine.dataset.restart === 'true') {
      engineNotice.hidden = true;
      retryEngine.hidden = true;
      retryEngine.dataset.restart = 'false';
    }
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
  const exportName = documentName;
  const warnings: string[] = [];
  const prepare = async (target: string) => {
    const result = await prepareExportSvg(await loaded.render(target), dark);
    warnings.push(...result.warnings);
    return result.svg;
  };
  try {
    let blob: Blob;
    let name = exportName.replace(/\.d2$/i, '');
    if (format === 'svg' || format === 'png') {
      const svg = await prepare(board.target);
      blob = format === 'png' ? await rasterizeSvg(svg) : new Blob([svg], { type: 'image/svg+xml' });
      name += `-${board.name === 'Root' ? 'root' : encodeURIComponent(board.name)}.${format}`;
    } else {
      const boards = await renderExportBoards(loaded.diagram, prepare, loaded.diagnostics);
      blob = format === 'zip' ? new Blob([exportBoardsZip(boards)], { type: 'application/zip' })
        : new Blob([exportBoardsHtml(boards, { title: exportName, script: offlineViewerScript(),
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
window.addEventListener('pagehide', () => { clearTimeout(debounce); clearTimeout(previewTimer); clearTimeout(activityTimer); previewQueue.invalidate(); ai?.dispose(); examplePicker.flush(); ++generation; editor.destroy(); viewer.destroy(); compiler.dispose(); });
documentName = examplePicker.initial.name;
currentDocumentKey = examplePicker.initial.key;
projectDownloadButton.hidden = !examplePicker.projectName;
viewport.setDocument(currentDocumentKey);
editor.open(examplePicker.initial.key, examplePicker.initial.source);
flowBuilder.refresh();
examplePicker.refresh();
clearTimeout(debounce);
void load(editor.source, documentName);
