import { expect, type Page } from '@playwright/test';
import { fileURLToPath } from 'node:url';

/**
 * Whether to compare against the checked-in screenshot baselines. They are Chromium
 * captures from macOS, so other engines and platforms skip only the pixel comparison
 * (behavioral assertions still run). Set ZOOMFLOW_SKIP_VISUAL=1 to skip them on macOS
 * versions that render text differently. CI runs only `@visual`-tagged tests on macOS,
 * so tag every test that calls this.
 */
export function comparesVisuals(browserName: string) {
  return browserName === 'chromium' && process.platform === 'darwin' && process.env.ZOOMFLOW_SKIP_VISUAL !== '1';
}

export const visualSkipReason = 'Screenshot baselines are Chromium captures from macOS; set ZOOMFLOW_SKIP_VISUAL=1 to skip them.';

export const projectFolder = fileURLToPath(new URL('../../fixtures/browser-project', import.meta.url));

export const source = (page: Page) => page.getByRole('textbox', { name: 'D2 source', exact: true });

/** Opens a project folder through the Open folder input.
 * Firefox and WebKit on Linux sometimes never acknowledge a directory upload that the
 * page already received, so this waits for the input's change event instead. */
export async function openFolder(page: Page, path: string) {
  await page.locator('#folder').evaluate((input) => {
    input.addEventListener('change', () => { input.dataset.testChanged = 'true'; }, { once: true });
  });
  const upload = page.locator('#folder').setInputFiles(path);
  upload.catch(() => {}); // A hung upload is rejected when the page closes.
  await Promise.race([upload, expect(page.locator('#folder')).toHaveAttribute('data-test-changed', 'true')]);
  await page.locator('#folder').evaluate((input) => { delete input.dataset.testChanged; });
}

/** A pane (the first by default) shows a finished preview of its current source. */
export async function previewReady(page: Page, pane: 'a' | 'b' = 'a') {
  const suffix = pane === 'b' ? '-b' : '';
  await expect(page.locator(`#preview-status${suffix}`)).toHaveText('Preview ready');
  await expect(page.locator(`#viewer${suffix}`)).toHaveAttribute('aria-busy', 'false');
}

/** The viewer (live or offline HTML) shows board `id` and is not still rendering it. */
export async function board(page: Page, id: string) {
  await expect(page.locator('.zf-stage')).toHaveAttribute('data-board', id);
  // Offline HTML may never set aria-busy, so wait only for a busy viewer to settle.
  await expect(page.locator('#viewer')).not.toHaveAttribute('aria-busy', 'true');
}

/** Follow the stage link to board `id`. */
export async function drill(page: Page, id: string) {
  await page.locator(`.zf-stage a[href="${id}"]`).click();
  await board(page, id);
}

/** Keep AI availability independent of the provider CLIs installed on this machine. */
export async function stubAiStatus(page: Page) {
  await page.route('**/api/ai/status', route => route.fulfill({ json: { available: true } }));
}

export async function chooseExample(page: Page, name: RegExp) {
  await page.locator('#example-picker summary').click();
  await page.locator('.example-menu').getByRole('button', { name }).and(page.locator('.example-option')).click();
  await previewReady(page);
}

/** Open a file from the opened `browser-project` folder. */
export async function chooseProjectFile(page: Page, path: string) {
  await page.locator('#example-picker summary').click();
  await page.locator(`.example-option[title="browser-project/${path}"]`).click();
}

// Vite's prebundled CodeMirror module: the same instance the app uses, so
// `EditorView.findFromDOM` finds the live editor. The only place tests name this path.
const codemirrorView = '/node_modules/.vite/deps/@codemirror_view.js';

/**
 * Run `fn` in the page with the first pane's CodeMirror view and the `EditorView` class.
 * `fn` is serialized like any `evaluate` callback: it may use only its arguments.
 */
export async function withEditorView<R, A = undefined>(page: Page, fn: (view: any, EditorView: any, arg: A) => R, arg?: A): Promise<Awaited<R>> {
  return page.locator('#editor').evaluate(async (el, { path, body, arg }) => {
    const { EditorView } = await import(/* @vite-ignore */ path);
    const view = EditorView.findFromDOM(el.querySelector('.cm-editor')!)!;
    return new Function(`return (${body})`)()(view, EditorView, arg);
  }, { path: codemirrorView, body: fn.toString(), arg: arg as A });
}

/** Read CodeMirror's document, including lines outside its rendered viewport. */
export const editorText = (page: Page) => withEditorView(page, view => view.state.doc.toString() as string);

/** Select source text through CodeMirror, as a person reading the source would. */
export async function selectSource(page: Page, text: string) {
  await withEditorView(page, (view, _, text) => {
    const from = view.state.doc.toString().indexOf(text);
    view.dispatch({ selection: { anchor: from, head: from + text.length } });
  }, text);
}

/** Select source text, scroll it into view and focus the editor. */
export async function cursorAt(page: Page, text: string) {
  await withEditorView(page, (view, _, text) => {
    const from = view.state.doc.toString().indexOf(text);
    view.dispatch({ selection: { anchor: from, head: from + text.length }, scrollIntoView: true });
    view.focus();
  }, text);
}

export async function insideStage(page: Page, selector: string) {
  const stage = (await page.locator('.zf-stage').boundingBox())!;
  const shape = (await page.locator(selector).boundingBox())!;
  expect(shape.x).toBeGreaterThanOrEqual(stage.x);
  expect(shape.y).toBeGreaterThanOrEqual(stage.y);
  expect(shape.x + shape.width).toBeLessThanOrEqual(stage.x + stage.width + 1);
  expect(shape.y + shape.height).toBeLessThanOrEqual(stage.y + stage.height + 1);
}
