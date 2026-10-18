import { Viewer } from '@zoomflow/viewer';
import example from '../../../fixtures/order.d2?raw';
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
    await viewer.setDocument(compiled.diagram, (target) => d2.render(compiled.diagram, {
      ...compiled.renderOptions, target, noXMLTag: true,
    }));
    if (request === generation) filename.textContent = name;
  } catch (error) {
    if (request === generation) viewer.setMessage(String(error), true);
  } finally {
    if (request === generation) viewer.setBusy(false);
  }
}
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
