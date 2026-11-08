import { expect, type Page } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { previewReady } from './helpers';

export const atlas = fileURLToPath(new URL('../../fixtures/atlas', import.meta.url));

export const openFolderMessage = 'Open the folder that contains this file to follow links to other diagrams.';

/** Pane A shows the atlas file at `path`, on `board`, with its preview ready. */
export async function showing(page: Page, path: string, board = 'root', pane: 'a' | 'b' = 'a') {
  const suffix = pane === 'b' ? '-b' : '';
  await expect(page.locator(`#viewer${suffix} .zf-stage`)).toHaveAttribute('data-board', board);
  await previewReady(page, pane);
  if (pane === 'a') await expect(page.locator('#filename')).toHaveAttribute('title', `atlas/${path}`);
  else await expect(page.locator('#pane-document-b')).toContainText(path.split('/').at(-1)!);
}

export const crumbs = (page: Page, viewer = '#viewer') => page.locator(`${viewer} .zf-breadcrumbs button`);

export const shapeMenu = async (page: Page, id: string, name: string) => {
  await page.locator(`#viewer .zf-stage [data-shape-id="${id}"]`).click({ button: 'right' });
  return page.getByRole('menu', { name: `Actions for ${name}` });
};

export async function showingProjectFile(page: Page, project: string, path: string) {
  await expect(page.locator('#filename')).toHaveAttribute('title', `${project}/${path}`);
  await previewReady(page);
}
