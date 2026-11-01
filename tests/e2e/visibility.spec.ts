import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { expect, test, type Page } from '@playwright/test';
import { openFolder, previewReady, source } from './helpers';
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
  await expect(page.locator('.board-selection')).toContainText('Hidden from export');
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
  await page.getByRole('checkbox', { name: 'Show all layers', exact: true }).check();
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
  await page.getByRole('checkbox', { name: 'Show all layers', exact: true }).check();
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
      await page.getByRole('checkbox', { name: 'Show all layers', exact: true }).check();
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
  await page.getByRole('checkbox', { name: 'Show all layers', exact: true }).check();
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

test('fits SVG, PNG, ZIP and HTML to visible content while preserving the editor viewport', async ({ page, context }, info) => {
  await page.goto('/'); await previewReady(page);
  await source(page).fill(`direction: right
Keep: Visible node {width: 220; height: 80; link: https://example.com; tooltip: Keep tooltip}
Hidden: Hidden wide node {width: 1600; height: 900}
Keep -> Hidden
`);
  await previewReady(page);
  const stage = page.locator('.zf-stage');
  expect(Number(await stage.locator(':scope > svg > svg').getAttribute('width'))).toBeGreaterThan(1800);
  await stage.locator('[data-shape-id="Hidden"]').focus(); await page.keyboard.press('h');
  const viewport = await stage.locator(':scope > svg').getAttribute('viewBox');
  let svgSize: number[] = [];
  for (const format of ['svg', 'png', 'zip', 'html']) {
    await selectMenuOption(page, '#export-format', format);
    const pending = page.waitForEvent('download');
    await downloadExport(page);
    const path = info.outputPath(`trimmed.${format}`);
    await (await pending).saveAs(path);
    const bytes = await readFile(path);
    if (format === 'png') {
      expect(bytes.readUInt32BE(16)).toBe(svgSize[0]);
      expect(bytes.readUInt32BE(20)).toBe(svgSize[1]);
    } else if (format === 'zip') {
      const svg = new TextDecoder().decode(unzipSync(bytes)['root.svg']);
      expect(svg).toContain(`viewBox="0 0 ${svgSize.join(' ')}"`);
    } else {
      const exported = await context.newPage();
      await exported.goto(`file://${path}`);
      const graph = format === 'html' ? exported.locator('.zf-stage > svg > svg') : exported.locator('svg > svg').first();
      const size = [Number(await graph.getAttribute('width')), Number(await graph.getAttribute('height'))];
      expect(size[0]).toBeGreaterThan(220); expect(size[0]).toBeLessThan(400);
      expect(size[1]).toBeGreaterThan(80); expect(size[1]).toBeLessThan(200);
      await expect(exported.locator('.appendix-icon')).toHaveCount(format === 'html' ? 2 : 1);
      await expect(exported.locator('text').filter({ hasText: /^Visible node$/ })).toHaveCount(1);
      if (format === 'svg') svgSize = size;
      await exported.close();
    }
    expect(await stage.locator(':scope > svg').getAttribute('viewBox')).toBe(viewport);
  }
});

test('removes fully hidden layers from export layout and keeps visible siblings compact', async ({ page, context }, info) => {
  await page.goto('/'); await previewReady(page);
  await source(page).fill(`direction: right
Root: Keep root
Hidden: Hidden branch {link: layers.Hidden}
Sibling: Keep branch {link: layers.Sibling}
Root -> Hidden
Root -> Sibling
layers: {
  Hidden: {Huge: Private huge layer {width: 1800; height: 1600}}
  Sibling: {Small: Keep small layer}
}
`);
  await previewReady(page);
  await page.getByRole('checkbox', { name: 'Show all layers', exact: true }).check();
  await expect(page.locator('[data-layer-board]')).toHaveCount(3);
  const hidden = page.locator('[data-shape-board="root"][data-shape-id="Hidden"]').locator('..');
  await hidden.focus(); await page.keyboard.press('h');
  await selectMenuOption(page, '#export-format', 'svg');
  const pending = page.waitForEvent('download');
  await downloadExport(page);
  const path = info.outputPath('trimmed-layers.svg');
  await (await pending).saveAs(path);
  const exported = await context.newPage();
  await exported.goto(`file://${path}`);
  await expect(exported.locator('[data-layer-board]')).toHaveCount(2);
  await expect(exported.locator('[data-layer-board="root.layers.Hidden"]')).toHaveCount(0);
  const size = (await exported.locator('svg').first().getAttribute('viewBox'))!.split(/\s+/).map(Number);
  expect(size[2]).toBeLessThan(1300); expect(size[3]).toBeLessThan(700);
  await expect(exported.locator('text').filter({ hasText: /^Keep small layer$/ })).toHaveCount(1);
  await exported.close();
  await expect(page.locator('.zf-stage [data-layer-board]')).toHaveCount(3);
});

test('exports an entirely hidden diagram as a small valid canvas', async ({ page, context }, info) => {
  await page.goto('/'); await previewReady(page);
  await source(page).fill('Only: Hidden {width: 1400; height: 1000}');
  await previewReady(page);
  await page.locator('[data-shape-id="Only"]').focus(); await page.keyboard.press('h');
  await selectMenuOption(page, '#export-format', 'svg');
  const pending = page.waitForEvent('download');
  await downloadExport(page);
  const path = info.outputPath('empty.svg');
  await (await pending).saveAs(path);
  const exported = await context.newPage();
  await exported.goto(`file://${path}`);
  await expect(exported.locator('svg').first()).toHaveAttribute('viewBox', '0 0 48 48');
  await expect(exported.locator('text')).toHaveCount(0);
  await exported.close();
});

test('static exports omit navigation glyphs while the editor and interactive HTML retain them', async ({ page, context }, info) => {
  await page.goto('/'); await previewReady(page);
  await source(page).fill(`Start: Start {shape: oval; link: layers.Detail}
Site: Documentation {link: https://example.com; tooltip: Helpful note}
Start -> Site
layers: {
  Detail: {
    Back: Back {shape: diamond; link: _}
    Leaf: Leaf {link: https://example.org}
  }
}
`);
  await previewReady(page);
  await expect(page.locator('.zf-stage .appendix-icon')).toHaveCount(3);
  let svgSize: number[] = [];
  for (const format of ['svg', 'png', 'zip', 'html']) {
    await selectMenuOption(page, '#export-format', format);
    const pending = page.waitForEvent('download');
    await downloadExport(page);
    const path = info.outputPath(`navigation-glyphs.${format}`);
    await (await pending).saveAs(path);
    const bytes = await readFile(path);
    if (format === 'png') {
      expect(bytes.readUInt32BE(16)).toBe(svgSize[0]);
      expect(bytes.readUInt32BE(20)).toBe(svgSize[1]);
    } else if (format === 'zip') {
      for (const data of Object.values(unzipSync(bytes))) {
        const glyphs = await page.evaluate(svg => {
          const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
          return [...doc.querySelectorAll('.appendix-icon')].filter(icon => !icon.querySelector('title')).length;
        }, new TextDecoder().decode(data));
        expect(glyphs).toBe(0);
      }
    } else {
      const exported = await context.newPage();
      await exported.goto(`file://${path}`);
      if (format === 'html') {
        await expect(exported.locator('.zf-stage .appendix-icon:not(:has(title))')).toHaveCount(2);
        await exported.locator('.zf-stage a[data-board="root.layers.Detail"]').click();
        await expect(exported.locator('.zf-stage')).toHaveAttribute('data-board', 'root.layers.Detail');
      } else {
        await expect(exported.locator('.appendix-icon')).toHaveCount(1);
        await expect(exported.locator('.appendix-icon title')).toHaveText('Helpful note');
        await expect(exported.locator('a[href="https://example.com"]')).toHaveCount(1);
        const graph = exported.locator('svg > svg').first();
        svgSize = [Number(await graph.getAttribute('width')), Number(await graph.getAttribute('height'))];
      }
      await exported.close();
    }
    await expect(page.locator('.zf-stage .appendix-icon')).toHaveCount(3);
  }
  await page.getByRole('checkbox', { name: 'Show all layers', exact: true }).check();
  await expect(page.locator('.zf-stage .appendix-icon')).toHaveCount(5);
  await selectMenuOption(page, '#export-format', 'svg');
  const pending = page.waitForEvent('download');
  await downloadExport(page);
  const path = info.outputPath('navigation-glyphs-layers.svg');
  await (await pending).saveAs(path);
  const exported = await context.newPage();
  await exported.goto(`file://${path}`);
  await expect(exported.locator('.appendix-icon')).toHaveCount(1);
  await expect(exported.locator('[data-layer-board]')).toHaveCount(2);
  await exported.close();
});
