import { exportBoardsHtml, exportBoardsZip, exportSourcesZip, renderExportBoards, indexBoards } from '@zoomflow/core';
import { prepareExportSvg, rasterizeSvg, offlineViewerScript, offlineViewerStyle, viewerStyle, type ViewerRoute } from '@zoomflow/viewer';
import { setupExamplePicker } from './example-picker';
import './style.css';
import { createCompiler } from './compiler';
import { setupReference } from './reference';
import { setupSplit, type SplitAxis } from './source-split';
import { setupViewportHeight } from './mobile-view';
import { readDirectoryHandle, readFolderInput } from './project-files';
import { setupShortcuts } from './shortcuts';
import { setupFlowBuilder } from './flow-builder';
import { createDocumentPane, type DocumentPane, type PaneContext, type PaneId } from './document-pane';
import { describeError, plural, safeFilename } from './text';
import { cloneSecondPane, nameParts, paneScope } from './pane-scope';

const canvasStyle = document.createElement('style');
canvasStyle.textContent = viewerStyle;
document.head.prepend(canvasStyle);
const workspace = document.querySelector<HTMLElement>('#workspace')!;
const paneRoots: Record<PaneId, HTMLElement> = {
  a: document.querySelector<HTMLElement>('#pane-a')!,
  b: document.querySelector<HTMLElement>('#pane-b')!,
};
const paneDivider = document.querySelector<HTMLElement>('#pane-divider')!;

/** The second pane is a copy of the first pane's untouched markup with its own element IDs.
 * The D2 reference stays a single panel that opens in the active pane.
 */
function secondPaneMarkup() {
  nameParts(paneRoots.a);
  const copy = cloneSecondPane(paneRoots.a, ['#d2-reference', '#reference-divider']);
  for (const [part, label] of [['preview-pane', 'Second diagram'], ['viewer', 'Second live preview'],
    ['source-pane', 'Second source editor'], ['mobile-view-switch', 'Second document view']]) {
    copy.querySelector(`[data-part="${part}"]`)!.setAttribute('aria-label', label);
  }
  return [...copy.childNodes];
}
const secondPane = secondPaneMarkup();

setupShortcuts();
const narrow = matchMedia('(max-width: 999px)');
const roomy = matchMedia('(min-width: 1400px)');
setupViewportHeight(narrow);
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

const panes: Partial<Record<PaneId, DocumentPane>> = {};
let active: PaneId = 'a';
const activePane = () => panes[active]!;
const otherPane = (pane: PaneId): PaneId => pane === 'a' ? 'b' : 'a';

const theme = document.querySelector<HTMLSelectElement>('#theme')!;
restorePreference(theme, 'zoomflow.theme');
const media = matchMedia('(prefers-color-scheme: dark)');
function updateTheme() {
  document.documentElement.dataset.theme = theme.value === 'system'
    ? media.matches ? 'dark' : 'light' : theme.value;
  for (const pane of Object.values(panes)) pane.viewer.setTheme(document.documentElement.dataset.theme === 'dark');
}
theme.addEventListener('change', updateTheme);
media.addEventListener('change', updateTheme);

// The pinned browser entry creates and owns D2's WASM worker. Import it lazily
// so the shell and loading state paint before the compiler is downloaded.
// Both panes share it; the worker answers each request by its message ID.
const compiler = createCompiler();
const engine = {
  notice: document.querySelector<HTMLElement>('#engine-notice')!,
  message: document.querySelector<HTMLElement>('#engine-message')!,
  retry: document.querySelector<HTMLButtonElement>('#retry-engine')!,
};
engine.retry.addEventListener('click', () => {
  const restart = engine.retry.dataset.restart === 'true';
  if (restart) compiler.restart();
  for (const pane of Object.values(panes)) pane.retry(restart);
});
const documentRoutes = new Map<string, ViewerRoute>();
const fileHandles = new Map<string, FileSystemFileHandle>();
type PickerWindow = Window & {
  showOpenFilePicker?: (options?: object) => Promise<FileSystemFileHandle[]>;
  showDirectoryPicker?: () => Promise<FileSystemDirectoryHandle>;
};
const pickerWindow = window as PickerWindow;
const fileStatus = document.querySelector<HTMLElement>('#file-status')!;
const exportStatus = document.querySelector<HTMLElement>('#export-status')!;
const projectDownloadButton = document.querySelector<HTMLButtonElement>('#save-project')!;
function setExportStatus(message: string, kind: 'info' | 'error' = 'info') {
  exportStatus.textContent = message;
  exportStatus.dataset.kind = kind;
  exportStatus.hidden = !message;
}
/** The export menu shows the result while open; the pane's live activity line announces it once. */
function reportExport(message: string, kind: 'info' | 'error' = 'info', pane = activePane()) {
  pane.setActivity(message, kind);
  setExportStatus(message, kind);
}
function setFileError(message: string) {
  fileStatus.textContent = message;
  fileStatus.hidden = !message;
  if (message) activePane().setActivity(message, 'error');
}

const flowBuilder = setupFlowBuilder((source, name) => {
  const key = examplePicker.rememberFile(name, source, '');
  void activePane().replaceDocument(source, name, key);
  activePane().showView('preview');
}, () => ({ source: activePane().source, name: activePane().name }));

function context(id: PaneId): PaneContext {
  return {
    compiler, picker: () => examplePicker, flowBuilder, engine, fileHandles, documentRoutes,
    isActive: () => active === id,
    tabbed: () => narrow.matches || workspace.dataset.layout === 'tabs',
    exportChanged: () => { if (active === id && panes[id]) updateExportLabel(); },
    setExportStatus,
    clearFileError: () => setFileError(''),
    revealSource: (pane, range) => { setActive(pane); panes[pane]?.focusSource(range); },
    lintChanged: () => {
      const source = panes[id]!.lintOptions;
      const other = panes[otherPane(id)];
      if (!other) return;
      other.lintOptions.missingBacklink.checked = source.missingBacklink.checked;
      other.lintOptions.boundaryPorts.checked = source.boundaryPorts.checked;
      other.updateLint();
    },
  };
}

panes.a = createDocumentPane('a', paneRoots.a, context('a'));
const examplePicker = setupExamplePicker({
  readSource: (pane) => panes[pane]?.source ?? '',
  open: (pane, document, reset) => {
    if (document) void panes[pane]?.replaceDocument(document.source, document.name, document.key, reset);
    else panes[pane]?.close();
  },
  onState: (pane, state) => {
    panes[pane]?.renderDraftState(state);
    if (pane === active) showDocumentState(state.dirty, state.identity.name, Boolean(state.identity.projectId));
  },
  forget: (key) => {
    for (const pane of Object.values(panes)) { pane.editor.forget(key); pane.viewport.forget(key); }
    fileHandles.delete(key); documentRoutes.delete(key);
  },
  checkpoint: (key) => {
    const restore = Object.values(panes).flatMap((pane) => [pane.editor.checkpoint(key), pane.viewport.checkpoint(key)]);
    const handle = fileHandles.get(key);
    const route = documentRoutes.get(key);
    return () => {
      restore.forEach((undo) => undo());
      if (handle) fileHandles.set(key, handle);
      if (route) documentRoutes.set(key, route);
    };
  },
  focusPane: (pane) => focusPane(pane),
});

function showDocumentState(dirty: boolean, name?: string, project = false) {
  document.title = name ? `${dirty ? '• ' : ''}${name} — Zoomflow` : 'Zoomflow';
  document.querySelector<HTMLElement>('#document-unsaved')!.hidden = !dirty;
  document.querySelector('#example-picker > summary')!.setAttribute('aria-label', dirty ? 'Choose a diagram — unsaved changes' : 'Choose a diagram');
  projectDownloadButton.hidden = !project;
}
/** Header commands, shortcuts and the D2 reference follow the pane being worked in. */
function setActive(pane: PaneId) {
  if (pane === active || !panes[pane]) return;
  active = pane;
  for (const id of ['a', 'b'] as const) paneRoots[id].toggleAttribute('data-active', id === pane);
  examplePicker.setTarget(pane);
  if (!activePane().key) showDocumentState(false);
  updateExportLabel();
}
paneRoots.a.toggleAttribute('data-active', true);
function focusPane(pane: PaneId) {
  setActive(pane);
  const target = panes[pane]!;
  const editor = target.editor.view.dom;
  if (editor.offsetParent) target.editor.view.focus();
  else target.viewer.stage.focus({ preventScroll: true });
}
for (const id of ['a', 'b'] as const) {
  const root = paneRoots[id];
  root.addEventListener('focusin', () => setActive(id));
  root.addEventListener('pointerdown', () => setActive(id), { capture: true });
}

const reference = setupReference(() => {
  const pane = activePane();
  return { preview: pane.scope.part('preview-pane'), source: pane.scope.part('source-pane'),
    showPreview: () => pane.showView('preview'), showSource: () => pane.showView('source') };
});
document.querySelector('#toggle-reference')!.addEventListener('click', () => activePane().showView('preview'));

function wirePaneHeader(id: PaneId) {
  const button = (name: string) => paneScope(id, paneRoots[id]).part<HTMLButtonElement>(name);
  button('pane-document').addEventListener('click', (event) => { event.stopPropagation(); setActive(id); examplePicker.choose(id); });
  button('pane-choose').addEventListener('click', (event) => { event.stopPropagation(); setActive(id); examplePicker.choose(id); });
  button('pane-start-empty').addEventListener('click', () => {
    setActive(id);
    const key = examplePicker.rememberFile('untitled.d2', '', '');
    void panes[id]!.replaceDocument('', 'untitled.d2', key).then(() => panes[id]!.focusSource());
  });
  button('pane-switch').addEventListener('click', () => focusPane(otherPane(id)));
}
wirePaneHeader('a');

/** Create the second pane the first time a split layout opens. */
function ensureSecondPane() {
  if (panes.b) return panes.b;
  paneRoots.b.append(...secondPane);
  // Start with the first pane's AI settings, then keep both panes' settings in step.
  const settings = ['ai-provider', 'ai-environment', 'ai-claude-config-dir'];
  const [a, b] = [paneScope('a', paneRoots.a), paneScope('b', paneRoots.b)];
  for (const name of settings) {
    const [first, second] = [a.part<HTMLInputElement>(name), b.part<HTMLInputElement>(name)];
    second.value = first.value;
    for (const [from, to] of [[first, second], [second, first]]) {
      from.addEventListener('change', () => {
        if (to.value === from.value) return;
        to.value = from.value;
        to.dispatchEvent(new Event('change'));
      });
    }
  }
  for (const name of ['missing-backlink', 'boundary-ports']) {
    b.part<HTMLInputElement>(name).checked = a.part<HTMLInputElement>(name).checked;
  }
  panes.b = createDocumentPane('b', paneRoots.b, context('b'));
  panes.b.viewer.setTheme(document.documentElement.dataset.theme === 'dark');
  panes.b.close();
  wirePaneHeader('b');
  splits.push(sourceSplit('b'));
  return panes.b;
}

const layoutSelect = document.querySelector<HTMLSelectElement>('#layout')!;
restorePreference(layoutSelect, 'zoomflow.layout');
/** All four views need room; narrower windows show the split as tabs. */
function effectiveLayout() {
  const layout = layoutSelect.value;
  return layout === 'single' ? 'single' : layout === 'quad' && roomy.matches ? 'quad' : 'tabs';
}
function sourceSplit(id: PaneId) {
  const root = paneRoots[id];
  const columns: SplitAxis = { container: workspace, storageKey: 'zoomflow.source.preview-share', properties: ['--preview-share', '--source-share'],
    minimum: 360, defaultShare: () => 50 + 12 * Math.max(0, Math.min(1, (workspace.clientWidth - 1100) / 340)),
    describe: (share) => `Diagram ${Math.round(share)}%, D2 source ${Math.round(100 - share)}%` };
  const rows: SplitAxis = { container: root, storageKey: 'zoomflow.split.preview-share', properties: ['--preview-share', '--source-share'],
    minimum: 160, defaultShare: () => 55, rows: true,
    describe: (share) => `Diagram ${Math.round(share)}%, D2 source ${Math.round(100 - share)}%` };
  return setupSplit(paneScope(id, root).part('source-divider'), () => {
    if (narrow.matches) return undefined;
    const layout = workspace.dataset.layout;
    return layout === 'single' && id === 'a' ? columns : layout === 'quad' ? rows : undefined;
  });
}
const splits = [sourceSplit('a'), setupSplit(paneDivider, () => narrow.matches || workspace.dataset.layout === 'single' ? undefined : {
  container: workspace, storageKey: 'zoomflow.split.pane-share', properties: ['--first-pane-share', '--second-pane-share'],
  minimum: 360, defaultShare: () => 50, describe: (share) => `First diagram ${Math.round(share)}%, second diagram ${Math.round(100 - share)}%`,
})];
function applyLayout() {
  const layout = effectiveLayout();
  const split = layout !== 'single';
  if (split) ensureSecondPane();
  workspace.dataset.layout = layout;
  paneRoots.b.hidden = !split;
  paneDivider.hidden = !split;
  for (const pane of Object.values(panes)) pane.root.querySelector<HTMLElement>('.pane-header')!.hidden = !split;
  if (!split && panes.b) {
    setActive('a');
    reference.reset({ preview: document.querySelector('#preview-pane')!, source: document.querySelector('#source-pane')!,
      showPreview: () => panes.a!.showView('preview'), showSource: () => panes.a!.showView('source') });
  }
  examplePicker.setSplit(split);
  if (!split) panes.b?.close();
  for (const pane of Object.values(panes)) pane.views.layoutChanged();
  for (const divider of splits) divider.refresh();
}
layoutSelect.addEventListener('change', applyLayout);
narrow.addEventListener('change', applyLayout);
roomy.addEventListener('change', applyLayout);

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
  const pane = activePane();
  if (!pane.key) return;
  const name = safeFilename(pane.name.replace(/\.d2$/i, '')) + '.d2';
  download(new Blob([pane.source], { type: 'text/plain;charset=utf-8' }), name);
  examplePicker.markDownloadRequested(pane.id);
  pane.setActivity(`Source download started: ${name}`);
});
projectDownloadButton.addEventListener('click', () => {
  const name = examplePicker.projectName(active);
  if (!name) return;
  try {
    const { fs, inputPath } = examplePicker.compilation(active);
    fs[inputPath] = activePane().source;
    const filename = `${safeFilename(name)}.zip`;
    download(new Blob([exportSourcesZip(fs)], { type: 'application/zip' }), filename);
    reportExport(`Project source download started: ${filename}`);
  } catch (error) { reportExport(`Project source download failed: ${describeError(error)}`, 'error'); }
});
window.addEventListener('keydown', (event) => {
  if (event.isComposing || event.altKey || event.shiftKey || !(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== 's') return;
  event.preventDefault();
  if (!event.repeat) activePane().save();
});

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
  const pane = panes[active];
  const documentExport = pane?.documentExport;
  exportButton.disabled = !documentExport;
  const count = documentExport ? indexBoards(documentExport.diagram).size : 0;
  if (documentExport && !explicitExportFormat) {
    exportChoices.querySelector<HTMLInputElement>(`input[value="${count > 1 ? 'html' : 'svg'}"]`)!.checked = true;
  }
  const allBoards = exportFormat.value === 'zip' || exportFormat.value === 'html';
  const formatName = ({ svg: 'SVG', png: 'PNG', zip: 'SVG ZIP', html: 'Interactive HTML' } as Record<string, string>)[exportFormat.value];
  document.querySelector('#export-scope')!.textContent = documentExport
    ? allBoards ? `Entire diagram · ${plural(count, 'board')} · ${formatName}`
      : `Current board: ${pane!.viewer.currentBoard?.name ?? 'Root'} · ${formatName}` : 'Compile the current source to export a diagram.';
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

exportButton.addEventListener('click', async () => {
  const pane = activePane();
  const loaded = pane.documentExport;
  const board = pane.viewer.currentBoard;
  if (!loaded || !board) return;
  const exportRevision = pane.generation;
  exportButton.disabled = true;
  const format = exportFormat.value;
  reportExport(`Preparing ${format.toUpperCase()} download…`, 'info', pane);
  const dark = document.documentElement.dataset.theme === 'dark';
  const exportName = pane.name;
  const warnings: string[] = [];
  // Interactive HTML follows its reader's color scheme; images keep the theme shown here.
  const theme = format === 'html' ? undefined : dark;
  const prepare = async (target: string) => {
    const result = await prepareExportSvg(await loaded.render(target), theme);
    warnings.push(...result.warnings);
    return result.svg;
  };
  try {
    let blob: Blob;
    let name = safeFilename(exportName.replace(/\.d2$/i, ''));
    if (format === 'svg' || format === 'png') {
      const svg = await prepare(board.target);
      blob = format === 'png' ? await rasterizeSvg(svg) : new Blob([svg], { type: 'image/svg+xml' });
      name += `-${board.name === 'Root' ? 'root' : safeFilename(board.name)}.${format}`;
    } else {
      const boards = await renderExportBoards(loaded.diagram, prepare, loaded.diagnostics);
      blob = format === 'zip' ? new Blob([exportBoardsZip(boards)], { type: 'application/zip' })
        : new Blob([exportBoardsHtml(boards, { title: exportName, script: offlineViewerScript(),
          style: offlineViewerStyle })], { type: 'text/html' });
      name += `.${format}`;
    }
    if (exportRevision !== pane.generation || pane.documentExport !== loaded) {
      reportExport('Export canceled because the source changed.', 'info', pane);
      return;
    }
    download(blob, name);
    const result = warnings.length ? `Download started: ${name}. ${[...new Set(warnings)].join(' ')}` : `Download started: ${name}`;
    reportExport(result, warnings.length > 0 ? 'error' : 'info', pane);
  } catch (error) {
    reportExport(`Export failed: ${describeError(error)}`, 'error', pane);
  }
  finally { exportButton.disabled = !activePane().documentExport || !activePane().current; }
});
async function openFile(file: File, handle?: FileSystemFileHandle) {
  try {
    if (!/\.d2$/i.test(file.name)) throw new Error('Choose a .d2 file.');
    const source = await file.text();
    setFileError('');
    const key = examplePicker.rememberFile(file.name, source);
    if (handle) fileHandles.set(key, handle);
    examplePicker.refresh();
    await activePane().replaceDocument(source, file.name, key);
  }
  catch (error) { setFileError(`Could not open file: ${describeError(error)}`); }
}
const fileInput = document.querySelector<HTMLInputElement>('#file')!;
fileInput.addEventListener('click', async (event) => {
  if (!pickerWindow.showOpenFilePicker) return;
  event.preventDefault();
  try {
    const [handle] = await pickerWindow.showOpenFilePicker({ types: [{ description: 'D2 source', accept: { 'text/plain': ['.d2'] } }] });
    if (handle) await openFile(await handle.getFile(), handle);
  } catch (error) {
    if (!(error instanceof DOMException && error.name === 'AbortError')) setFileError(`Could not open file: ${describeError(error)}`);
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
  await activePane().replaceDocument(selection.source, selection.name, selection.key);
}
const folderInput = document.querySelector<HTMLInputElement>('#folder')!;
async function chooseFolder() {
  if (!pickerWindow.showDirectoryPicker) { folderInput.click(); return; }
  try { await openFolder(await readDirectoryHandle(await pickerWindow.showDirectoryPicker())); }
  catch (error) {
    if (!(error instanceof DOMException && error.name === 'AbortError')) setFileError(`Could not open folder: ${describeError(error)}`);
  }
}
document.querySelector<HTMLButtonElement>('#open-folder')!.addEventListener('click', () => void chooseFolder());
document.querySelector<HTMLButtonElement>('#open-folder-picker')!.addEventListener('click', () => void chooseFolder());
folderInput.addEventListener('change', async () => {
  const files = folderInput.files;
  try { if (files?.length) await openFolder(await readFolderInput(files)); }
  catch (error) { setFileError(`Could not open folder: ${describeError(error)}`); }
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
  // Dropping onto a pane opens the file there.
  const pane = (['a', 'b'] as const).find((id) => event.target instanceof Node && paneRoots[id].contains(event.target));
  if (pane) setActive(pane);
  const file = event.dataTransfer?.files[0];
  if (file) void openFile(file);
});
window.addEventListener('pagehide', () => {
  examplePicker.flush();
  for (const pane of Object.values(panes)) pane.dispose();
  compiler.dispose();
});
updateTheme();
updateExportLabel();
panes.a.open(examplePicker.initial);
applyLayout();
