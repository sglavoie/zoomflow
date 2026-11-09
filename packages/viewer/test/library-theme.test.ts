// @vitest-environment happy-dom
import { expect, it } from 'vitest';
import { prepareExportSvg } from '../src/export';
import { libraryTheme } from '../src/library-theme';

const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><g class="zf-filled"><g class="shape"><rect width="20" height="20" fill="#e9f0fa"/></g><text fill="#203044">Step</text></g></svg>';
it('embeds a portable filled palette, freezes it for images, and leaves custom attributes intact', async () => {
  const adaptive = libraryTheme(svg);
  expect(adaptive).toContain('prefers-color-scheme:dark');
  expect(libraryTheme(adaptive)).toBe(adaptive);
  const dark = await prepareExportSvg(svg, true);
  expect(dark.svg).toContain('@media all');
  expect(dark.svg).not.toContain('prefers-color-scheme');
  const light = await prepareExportSvg(svg, false);
  expect(light.svg).toContain('@media not all');
  const custom = libraryTheme(svg.replace('#e9f0fa', '#ff0000').replace('#203044', '#111111'));
  expect(custom).toContain('fill="#ff0000"');
  expect(custom).toContain('fill="#111111"');
  expect(libraryTheme('<svg><rect fill="#ff0000"/></svg>')).toBe('<svg><rect fill="#ff0000"/></svg>');
});
