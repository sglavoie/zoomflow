import { expect, type Page } from '@playwright/test';
import { fileURLToPath } from 'node:url';

export const projectFolder = fileURLToPath(new URL('../../fixtures/browser-project', import.meta.url));

export const source = (page: Page) => page.getByRole('textbox', { name: 'D2 source', exact: true });

/** The first pane shows a finished preview of its current source. */
export async function previewReady(page: Page) {
  await expect(page.locator('#preview-status')).toHaveText('Preview ready');
  await expect(page.locator('#viewer')).toHaveAttribute('aria-busy', 'false');
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

/** Select source text through CodeMirror, as a person reading the source would. */
export async function selectSource(page: Page, text: string) {
  await page.locator('#editor').evaluate(async (el, text) => {
    const path = '/node_modules/.vite/deps/@codemirror_view.js';
    const { EditorView } = await import(/* @vite-ignore */ path);
    const view = EditorView.findFromDOM(el.querySelector('.cm-editor')!)!;
    const from = view.state.doc.toString().indexOf(text);
    view.dispatch({ selection: { anchor: from, head: from + text.length } });
  }, text);
}

/** Select source text, scroll it into view and focus the editor. */
export async function cursorAt(page: Page, text: string) {
  await page.locator('#editor').evaluate(async (el, text) => {
    const path = '/node_modules/.vite/deps/@codemirror_view.js';
    const { EditorView } = await import(/* @vite-ignore */ path);
    const view = EditorView.findFromDOM(el.querySelector('.cm-editor')!)!;
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
