import { exportBoardsHtml, exportBoardsZip, renderExportBoards, indexShapeSources, lint, type CompileResponse, type ShapeSource, type Diagram, type LintDiagnostic } from '@zoomflow/core';
import { Viewer, prepareExportSvg, rasterizeSvg, offlineViewerScript, type RenderBoard } from '@zoomflow/viewer';
import example from '../../../fixtures/order.d2?raw';
import standardLibrary from '../../../stdlib/zoomflow.d2?raw';
import exportStyle from './style.css?raw';
import './style.css';
import { SourceEditor, compilerDiagnostics, lintDiagnostics } from './editor';
import { diagramFonts } from './fonts';

const viewer = new Viewer(document.querySelector<HTMLElement>('#viewer')!);
const filename = document.querySelector<HTMLElement>('#filename')!;
const theme = document.querySelector<HTMLSelectElement>('#theme')!;
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
let documentName = 'order.d2';
let sourceMap: ShapeSource[] = [];
let mappedSource: string | undefined;
let debounce: ReturnType<typeof setTimeout> | undefined;
const errorBanner = document.querySelector<HTMLElement>('#compile-error')!;
const lintSummary = document.querySelector<HTMLElement>('#lint-summary')!;
const missingBacklink = document.querySelector<HTMLInputElement>('#missing-backlink')!;
const formatButton = document.querySelector<HTMLButtonElement>('#format-source')!;
const formatStatus = document.querySelector<HTMLElement>('#format-status')!;
let lintDocument: CompileResponse | undefined;
const editor = new SourceEditor(document.querySelector<HTMLElement>('#editor')!, example, () => {
  // Invalidate immediately, including requests still awaiting WASM/render startup.
  ++generation;
  formatStatus.hidden = true;
  viewer.cancelPendingRender();
  sourceMap = [];
  lintDocument = undefined;
  lintSummary.textContent = 'Lint pending…';
  viewer.highlightShapes([]);
  clearTimeout(debounce);
  debounce = setTimeout(() => void load(editor.source, documentName), 350);
}, () => void highlightSelection(true), () => void formatSource());

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
  const document = editor.view.state.doc;
  const source = editor.source;
  formatButton.disabled = true;
  formatStatus.textContent = 'Formatting…';
  formatStatus.hidden = false;
  try {
    const compiled = mappedSource === source && lintDocument ? lintDocument : await compileSource(source);
    // Edits or opening another file invalidate this request, even after undo.
    if (editor.view.state.doc !== document) return;
    const formatted = compiled.fs[compiled.inputPath];
    if (typeof formatted !== 'string') throw new Error('D2 did not return formatted source.');
    formatStatus.textContent = editor.format(formatted) ? 'Source formatted.' : 'Source is already formatted.';
    formatStatus.hidden = false;
  } catch (error) {
    if (editor.view.state.doc !== document) return;
    formatStatus.textContent = `Formatting failed: ${compilerDiagnostics(error, source).map((item) => item.message).join('\n')}`;
    formatStatus.hidden = false;
  } finally { formatButton.disabled = false; }
}
formatButton.addEventListener('click', () => void formatSource());

function updateLint() {
  if (!lintDocument || mappedSource !== editor.source) return;
  const result = lint(lintDocument, { missingBacklink: missingBacklink.checked });
  editor.diagnostics(lintDiagnostics(result.diagnostics, editor.source, sourceMap));
  const errors = result.diagnostics.filter((item) => item.severity === 'error').length;
  const warnings = result.diagnostics.length - errors;
  lintSummary.textContent = errors || warnings ? `${errors} lint error(s), ${warnings} warning(s)` : 'No lint issues';
}
missingBacklink.addEventListener('change', updateLint);
document.querySelector('#show-diagnostics')!.addEventListener('click', () => editor.showDiagnostics());

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
  const shape = event.target instanceof Element ? event.target.closest<SVGElement>('[data-shape-id]') : null;
  const entry = shape && sourceMap.find((item) => item.board === viewer.currentBoard?.id && item.shape === shape.dataset.shapeId);
  if (!entry) return;
  const linked = Boolean(shape.closest('a'));
  if (linked && event.altKey) { event.preventDefault(); event.stopImmediatePropagation(); }
  editor.select(entry, !linked || event.altKey);
  void highlightSelection(false);
}, { capture: true });
let documentExport: { diagram: Diagram; render: RenderBoard; name: string; diagnostics: LintDiagnostic[] } | undefined;
const exportButton = document.querySelector<HTMLButtonElement>('#export')!;
async function load(source: string, name: string) {
  const request = ++generation;
  viewer.setBusy(true);
  viewer.setMessage('Compiling diagram…');
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
    await viewer.setDocument(compiled.diagram, render, diagnostics);
    if (request === generation) {
      filename.textContent = name;
      sourceMap = indexShapeSources(compiled.diagram, compiled.graph, source);
      mappedSource = source;
      lintDocument = compiled;
      updateLint();
      errorBanner.hidden = true;
      errorBanner.textContent = '';
      void highlightSelection(false);
      documentExport = { diagram: compiled.diagram, render, name, diagnostics };
      exportButton.disabled = false;
    }
  } catch (error) {
    if (request === generation) {
      const diagnostics = compilerDiagnostics(error, source);
      editor.diagnostics(diagnostics);
      lintDocument = undefined;
      lintSummary.textContent = 'Lint unavailable until compilation succeeds';
      errorBanner.textContent = `Error: ${diagnostics.map((item) => item.message).join('\n')} — Showing the last good preview.`;
      errorBanner.hidden = false;
      viewer.setMessage('');
    }
  } finally {
    if (request === generation) viewer.setBusy(false);
  }
}

exportButton.addEventListener('click', async () => {
  const loaded = documentExport;
  const board = viewer.currentBoard;
  if (!loaded || !board) return;
  exportButton.disabled = true;
  const format = document.querySelector<HTMLSelectElement>('#export-format')!.value;
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
          style: exportStyle + (dark ? ':root{color-scheme:dark;color:#e4eaf2;background:#111722}.zf-stage{background:#0a0f25}' : '') })], { type: 'text/html' });
      name += `.${format}`;
    }
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = name;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    viewer.setMessage(warnings.length ? [...new Set(warnings)].join(' ') : `Exported ${name}`, warnings.length > 0);
  } catch (error) { viewer.setMessage(`Export failed: ${String(error)}`, true); }
  finally { exportButton.disabled = false; }
});
async function openFile(file: File) {
  try {
    const source = await file.text();
    documentName = file.name;
    filename.textContent = file.name;
    editor.replace(source);
    clearTimeout(debounce);
    await load(source, file.name);
  }
  catch (error) { viewer.setMessage(String(error), true); }
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
window.addEventListener('pagehide', () => { clearTimeout(debounce); ++generation; editor.destroy(); viewer.destroy(); void compiler.then((d2) => d2.dispose()); });
void load(example, 'order.d2');
