import { expect, type Page, type TestInfo } from '@playwright/test';
import { selectMenuOption, downloadExport } from './menu';

export async function download(page: Page, format: string, info: TestInfo) {
  await selectMenuOption(page, '#export-format', format);
  const pending = page.waitForEvent('download');
  await downloadExport(page);
  const result = await pending;
  const path = info.outputPath(result.suggestedFilename());
  await result.saveAs(path);
  await expect(page.locator('#export')).toBeEnabled();
  return path;
}
