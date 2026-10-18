import { exportBoardsHtml, exportBoardsZip, renderExportBoards, type Diagram } from '@zoomflow/core';
import { Viewer, prepareExportSvg, rasterizeSvg, offlineViewerScript, type RenderBoard } from '@zoomflow/viewer';
import example from '../../../fixtures/order.d2?raw';
import exportStyle from './style.css?raw';
import './style.css';

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
let documentExport: { diagram: Diagram; render: RenderBoard; name: string } | undefined;
const exportButton = document.querySelector<HTMLButtonElement>('#export')!;
async function load(source: string, name: string) {
  const request = ++generation;
  viewer.setBusy(true);
  viewer.setMessage('Compiling diagram…');
  try {
    const d2 = await compiler;
    const padValue = new URLSearchParams(location.search).get('pad');
    const pad = padValue === null ? 100 : Number(padValue);
    const compiled = await d2.compile(source, {
      layout: 'elk', themeID: 0, darkThemeID: 200,
      pad: Number.isFinite(pad) && pad >= 0 ? pad : 100,
    });
    if (request !== generation) return;
    const render: RenderBoard = (target) => d2.render(compiled.diagram, {
      ...compiled.renderOptions, target, noXMLTag: true,
    });
    await viewer.setDocument(compiled.diagram, render);
    if (request === generation) {
      filename.textContent = name;
      documentExport = { diagram: compiled.diagram, render, name };
      exportButton.disabled = false;
    }
  } catch (error) {
    if (request === generation) viewer.setMessage(String(error), true);
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
      const boards = await renderExportBoards(loaded.diagram, prepare);
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
  try { await load(await file.text(), file.name); }
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
window.addEventListener('pagehide', () => { viewer.destroy(); void compiler.then((d2) => d2.dispose()); });
void load(example, 'order.d2');
