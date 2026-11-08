import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { expect, test, type Page } from '@playwright/test';
import { openFolder, previewReady, source, openBoards, closeBoards } from './helpers';
import { downloadExport, selectMenuOption } from './menu';

const { unzipSync } = createRequire(new URL('../../packages/core/package.json', import.meta.url))('fflate') as {
  unzipSync: (data: Uint8Array) => Record<string, Uint8Array>;
};

const diagram = 'direction: right\nSecret: Private detail {tooltip: Internal note}\nPublic: Share this\nPublic -> Secret: Sensitive connection\nlayers: {\n  Detail: { Secret: Visible on another board }\n}\n';
const secret = (page: Page) => page.locator('.zf-stage [data-shape-id="Secret"]');
async function load(page: Page) {
  await page.goto('/');
  await previewReady(page);
  await source(page).fill(diagram);
  await previewReady(page);
}
async function hide(page: Page) {
  await secret(page).click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Hide from export', exact: true }).click();
  await expect(secret(page)).toHaveAttribute('data-export-hidden', '');
}

test('menu and H toggle export visibility, retaining focus and leaving source typing alone', async ({ page }) => {
  await load(page);
  const original = await source(page).textContent();
  await hide(page);
  await expect(secret(page)).toHaveCSS('opacity', '0.3');
  await expect(page.locator('.zf-hidden-label')).toHaveText('Hidden from export');
  await expect(page.locator('.board-selection')).toHaveAttribute('aria-label', /Hidden from export/);
  await expect(secret(page)).toBeFocused();
  await page.keyboard.press('h');
  await expect(secret(page)).not.toHaveAttribute('data-export-hidden', '');
  await expect(page.locator('.zf-hidden-label')).toHaveCount(0);
  await page.keyboard.press('h');
  await expect(secret(page)).toHaveAttribute('data-export-hidden', '');
  await page.keyboard.press('Shift+F10');
  await page.getByRole('menuitem', { name: 'Unhide from export', exact: true }).click();
  await expect(secret(page)).not.toHaveAttribute('data-export-hidden', '');
  expect(await source(page).textContent()).toBe(original);
  await source(page).press('ControlOrMeta+End');
  await source(page).press('Enter');
  await source(page).pressSequentially('h');
  await previewReady(page);
  await expect(page.locator('.zf-stage [data-shape-id="h"]')).toBeVisible();
  await expect(secret(page)).not.toHaveAttribute('data-export-hidden', '');
});

test('SVG, PNG, ZIP and HTML exports honor hidden nodes and keep other boards independent', async ({ page, context }, info) => {
  await load(page);
  await hide(page);
  for (const format of ['svg', 'png', 'zip', 'html']) {
    await selectMenuOption(page, '#export-format', format);
    await expect(page.locator('#export-scope')).toContainText('1 hidden shape omitted');
    const pending = page.waitForEvent('download');
    await downloadExport(page);
    const download = await pending;
    const path = info.outputPath(`hidden.${format}`);
    await download.saveAs(path);
    const bytes = await readFile(path);
    if (format === 'png') {
      expect(bytes.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
      continue;
    }
    if (format === 'zip') {
      const files = unzipSync(bytes);
      const root = new TextDecoder().decode(files['root.svg']);
      expect(root).not.toContain('Private detail');
      expect(root).not.toContain('Sensitive connection');
      expect(root).toContain('Share this');
      expect(new TextDecoder().decode(files['Detail.svg'])).toContain('Visible on another board');
      continue;
    }
    if (format === 'html') {
      const offline = await context.newPage();
      await offline.goto(`file://${path}`);
      await expect(offline.locator('.zf-stage')).toContainText('Share this');
      await expect(offline.locator('.zf-stage')).not.toContainText('Private detail');
      await expect(offline.locator('.zf-stage')).not.toContainText('Sensitive connection');
      await offline.getByRole('button', { name: 'Find in diagram', exact: true }).click();
      await offline.getByRole('searchbox').fill('Private detail');
      await expect(offline.getByRole('option')).toHaveCount(0);
      await offline.close();
      continue;
    }
    const svg = bytes.toString();
    expect(svg).not.toContain('Private detail');
    expect(svg).not.toContain('Sensitive connection');
    expect(svg).not.toContain('Internal note');
    expect(svg).toContain('Share this');
    expect(svg).not.toContain('Hidden from export');
  }
  await secret(page).focus();
  await page.keyboard.press('h');
  await selectMenuOption(page, '#export-format', 'svg');
  const pending = page.waitForEvent('download');
  await downloadExport(page);
  const restored = info.outputPath('restored.svg');
  await (await pending).saveAs(restored);
  expect(await readFile(restored, 'utf8')).toContain('Private detail');
});

test('hiding a container dims its children and removes the subtree and incident edges from a layered export', async ({ page }, info) => {
  await page.goto('/'); await previewReady(page);
  await source(page).fill('Group: Private container {\n  Child: Private child\n}\nPublic: Share this\nPublic -> Group.Child: Private edge\nlayers: {\n  Detail: { Other: Keep this layer }\n}\n');
  await previewReady(page);
  await page.locator('.zf-stage [data-shape-id="Group"]').focus();
  await page.keyboard.press('h');
  await expect(page.locator('.zf-stage [data-shape-id="Group.Child"]')).toHaveAttribute('data-export-hidden', '');
  await openBoards(page);
  await page.getByRole('checkbox', { name: 'Show all layers', exact: true }).check();
  await closeBoards(page);
  await expect(page.locator('[data-layer-board]')).toHaveCount(2);
  await selectMenuOption(page, '#export-format', 'svg');
  await expect(page.locator('#export-scope')).toContainText('2 hidden shapes omitted');
  const pending = page.waitForEvent('download');
  await downloadExport(page);
  const path = info.outputPath('container.svg');
  await (await pending).saveAs(path);
  const svg = await readFile(path, 'utf8');
  expect(svg).not.toContain('Private container');
  expect(svg).not.toContain('Private child');
  expect(svg).not.toContain('Private edge');
  expect(svg).toContain('Share this');
  expect(svg).toContain('Keep this layer');
});

test('atlas exports apply visibility choices remembered for another project file', async ({ page, context }, info) => {
  const folder = info.outputPath('project');
  await mkdir(folder, { recursive: true });
  await writeFile(`${folder}/index.d2`, 'Next: {link: ./other.d2}\nRoot: Keep root\n');
  await writeFile(`${folder}/other.d2`, 'Secret: Private atlas content\nPublic: Keep project content\n');
  await page.goto('/'); await previewReady(page);
  await openFolder(page, folder); await previewReady(page);
  await page.locator('.zf-stage a[data-file="./other.d2"]').click();
  await previewReady(page);
  await hide(page);
  await page.getByRole('navigation', { name: 'Breadcrumb' }).getByRole('button', { name: 'index', exact: true }).click();
  await previewReady(page);
  await selectMenuOption(page, '#export-format', 'atlas');
  const pending = page.waitForEvent('download');
  await downloadExport(page);
  const path = info.outputPath('hidden-atlas.html');
  await (await pending).saveAs(path);
  const offline = await context.newPage();
  await offline.goto(`file://${path}`);
  await expect(offline.locator('.zf-stage')).toContainText('Keep root');
  await offline.locator('.zf-stage a[data-file="./other.d2"]').click();
  await expect(offline.locator('.zf-stage')).toContainText('Keep project content');
  await expect(offline.locator('.zf-stage')).not.toContainText('Private atlas content');
  await offline.close();
});

test('hiding a shared parent hides its connected branches and nested detail boards and restores their choices', async ({ page }, info) => {
  await page.goto('/'); await previewReady(page);
  await source(page).fill(`...@zoomflow
Start: Start
Work: Do something
Start -> Work
Branch: Topic {link: layers.Detail}
layers: {
  Detail: {
    n: Topic {class: zf-topic}
    first: First idea {link: layers.Deep}
    second: Second idea
    n -- first
    n -- second
    layers: {
      Deep: {
        n: First idea {class: zf-topic}
        leaf: Deep child
        n -- leaf
      }
    }
  }
}
`);
  await previewReady(page);
  await openBoards(page);
  await page.getByRole('checkbox', { name: 'Show all layers', exact: true }).check();
  await closeBoards(page);
  await expect(page.locator('[data-layer-board]')).toHaveCount(3);
  await expect(page.locator('[data-merged-root]')).toHaveCount(2);
  const second = page.locator('[data-shape-board="root.layers.Detail"][data-shape-id="second"]');
  const first = page.locator('[data-shape-board="root.layers.Detail"][data-shape-id="first"]');
  const leaf = page.locator('[data-shape-board="root.layers.Detail.layers.Deep"][data-shape-id="leaf"]');
  await second.focus(); await page.keyboard.press('h');
  const parent = page.locator('[data-shape-board="root"][data-shape-id="Branch"]').locator('..');
  await parent.focus(); await page.keyboard.press('h');
  await expect(first.locator('..')).toHaveAttribute('data-export-hidden', '');
  await expect(second).toHaveAttribute('data-export-hidden', '');
  await expect(leaf).toHaveAttribute('data-export-hidden', '');
  await expect(page.locator('[data-shape-id="Start"]')).not.toHaveAttribute('data-export-hidden', '');
  await selectMenuOption(page, '#export-format', 'svg');
  const pending = page.waitForEvent('download');
  await downloadExport(page);
  const path = info.outputPath('hidden-branch.svg');
  await (await pending).saveAs(path);
  const svg = await readFile(path, 'utf8');
  for (const label of ['Topic', 'First idea', 'Second idea', 'Deep child']) expect(svg).not.toContain(label);
  expect(svg).toContain('Do something');
  await parent.focus(); await page.keyboard.press('h');
  await expect(first.locator('..')).not.toHaveAttribute('data-export-hidden', '');
  await expect(leaf).not.toHaveAttribute('data-export-hidden', '');
  await expect(second).toHaveAttribute('data-export-hidden', '');
});

test('hiding a node removes both its link and tooltip badges from single-board and layer exports', async ({ page, context }, info) => {
  await page.goto('/'); await previewReady(page);
  await source(page).fill(`Hidden: Private node {link: https://example.com/private; tooltip: Private tooltip}
Visible: Keep node {link: https://example.org/keep; tooltip: Keep tooltip}
layers: {
  Detail: { Hidden: Private detail {link: https://example.com/detail; tooltip: Private detail tooltip} }
}
`);
  await previewReady(page);
  const hidden = page.locator('.zf-stage [data-shape-id="Hidden"]');
  const badges = page.locator('.zf-stage [data-badge-shape="Hidden"]');
  await expect(badges).toHaveCount(2);
  await page.getByRole('button', { name: 'Zoom in', exact: true }).click();
  await hidden.locator('..').focus(); await page.keyboard.press('h');
  // The link badge moves with its anchor; the separate tooltip badge is marked explicitly.
  for (const badge of await badges.all()) {
    expect(await badge.evaluate(node => Boolean(node.closest('[data-export-hidden]')))).toBe(true);
  }
  for (const layers of [false, true]) {
    if (layers) {
      await openBoards(page);
  await page.getByRole('checkbox', { name: 'Show all layers', exact: true }).check();
  await closeBoards(page);
      await expect(page.locator('[data-layer-board]')).toHaveCount(2);
      const detail = page.locator('[data-shape-board="root.layers.Detail"][data-shape-id="Hidden"]').locator('..');
      await detail.focus(); await page.keyboard.press('h');
    }
    await selectMenuOption(page, '#export-format', 'svg');
    const pending = page.waitForEvent('download');
    await downloadExport(page);
    const path = info.outputPath(layers ? 'badges-layers.svg' : 'badges-board.svg');
    await (await pending).saveAs(path);
    const exported = await context.newPage();
    await exported.goto(`file://${path}`);
    await expect(exported.locator('.appendix-icon')).toHaveCount(1);
    await expect(exported.locator('[data-badge-shape="Hidden"]')).toHaveCount(0);
    await expect(exported.locator('[data-badge-shape="Visible"]')).toHaveCount(1);
    await exported.close();
    const svg = await readFile(path, 'utf8');
    expect(svg).not.toContain('Private node');
    expect(svg).not.toContain('Private tooltip');
    expect(svg).toContain('Keep tooltip');
  }
  const root = page.locator('[data-shape-board="root"][data-shape-id="Hidden"]').locator('..');
  await root.focus(); await page.keyboard.press('h');
  const restored = page.locator('[data-layer-board="root"] [data-badge-shape="Hidden"]');
  for (const badge of await restored.all()) {
    expect(await badge.evaluate(node => Boolean(node.closest('[data-export-hidden]')))).toBe(false);
  }
});

test('hiding a linked flow removes its oval terminal and exports the parent branch without navigation glyphs', async ({ page, context }, info) => {
  await page.goto('/'); await previewReady(page);
  await source(page).fill(`...@zoomflow
n: Review the request {class: zf-topic}
entry: Topic {link: layers.Branch}
n -- entry
layers: {
  Branch: {
    n: Topic {class: zf-topic}
    keep: 22
    selected: asdasd {link: layers.Flow}
    n -- keep
    n -- selected
    layers: {
      Flow: {
        Start: Start {class: zf-terminal}
        Work: Do something {class: zf-step}
        Done: Done {class: zf-terminal; link: layers.Done}
        Start -> Work -> Done
        layers: {
          Done: {
            n: Done {class: zf-topic}
            first: First idea
            second: Second idea
            n -- first
            n -- second
          }
        }
      }
    }
  }
}
`);
  await previewReady(page);
  await openBoards(page);
  await page.getByRole('checkbox', { name: 'Show all layers', exact: true }).check();
  await closeBoards(page);
  await expect(page.locator('[data-layer-board]')).toHaveCount(4);
  await expect(page.locator('.zf-stage .appendix-icon')).toHaveCount(3);
  const selected = page.locator('[data-shape-board="root.layers.Branch"][data-shape-id="selected"]').locator('..');
  await selected.focus(); await page.keyboard.press('h');
  await selectMenuOption(page, '#export-format', 'svg');
  const pending = page.waitForEvent('download');
  await downloadExport(page);
  const path = info.outputPath('hidden-oval-flow.svg');
  await (await pending).saveAs(path);
  const exported = await context.newPage();
  await exported.goto(`file://${path}`);
  await expect(exported.locator('text').filter({ hasText: /^22$/ })).toHaveCount(1);
  await expect(exported.locator('.appendix-icon')).toHaveCount(0);
  await expect(exported.locator('[data-shape-id="entry"]')).toHaveCount(1);
  await expect(exported.locator('[data-layer-board="root.layers.Branch.layers.Flow"] .appendix-icon')).toHaveCount(0);
  await exported.close();
});
