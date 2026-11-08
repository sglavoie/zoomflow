import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { expect, test } from '@playwright/test';
import { previewReady, source } from './helpers';
import { downloadExport, selectMenuOption } from './menu';

const { unzipSync } = createRequire(new URL('../../packages/core/package.json', import.meta.url))('fflate') as {
  unzipSync: (data: Uint8Array) => Record<string, Uint8Array>;
};

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
