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

it('coordinates elevated connectors without changing an authored heavier stroke', () => {
  const elevated = svg.replace('zf-filled', 'zf-step zf-filled zf-shadow').replace('</svg>', '<path class="connection" style="stroke-width:1;"/><path class="connection" style="stroke-width:3;"/></svg>');
  const result = libraryTheme(elevated);
  expect(result).toContain('stroke-width:1.5;stroke-linecap:round');
  expect(result).toContain('stroke-width:3;');
  expect(libraryTheme(result)).toBe(result);
});

it('carries viewer lighting through interactive preparation without adding it to image exports', async () => {
  const input = svg.replace('</svg>', '<style>@media (prefers-color-scheme:dark){.d2 .stroke-B1{stroke:#8eaed7;}.d2 .fill-N7{fill:#121c2a;}}</style></svg>');
  const viewer = libraryTheme(input, true);
  expect(viewer).toContain('id="zf-lit-step"');
  expect(viewer).toContain('fill: #0e111d');
  expect(viewer).toContain('stroke: #a1bbde');
  expect(libraryTheme(viewer, true)).toBe(viewer);
  const interactive = await prepareExportSvg(input, undefined, { interactive: true });
  expect(interactive.svg).toContain('id="zf-library-surfaces"');
  expect(interactive.svg).toContain('prefers-color-scheme:dark');
  const image = await prepareExportSvg(input, true);
  expect(image.svg).not.toContain('zf-lit-');
  expect(image.svg).toContain('fill: #26364c');
  expect(image.svg).not.toContain('#a1bbde');
  const custom = libraryTheme(input.replace('#8eaed7', '#123456').replace('#121c2a', '#223344'), true);
  expect(custom).not.toContain('#a1bbde');
  expect(custom).not.toContain('fill: #0e111d');
});
