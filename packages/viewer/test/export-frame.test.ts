// @vitest-environment happy-dom
import { expect, it } from 'vitest';
import { frameExportSvg } from '../src/export-frame';

const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="-10 -20 400 200"><style>.label{fill:red}</style><text class="label">Diagram</text></svg>';
it('frames a prepared image without losing its viewport, styles or literal title text', () => {
  const framed = frameExportSvg(svg, { frame: true, title: '<script>alert(1)</script>', subtitle: 'A & B' });
  const root = new DOMParser().parseFromString(framed, 'image/svg+xml').documentElement;
  expect(root.querySelector('script')).toBeNull();
  expect([...root.querySelectorAll(':scope > text')].map(text => text.textContent).join('')).toBe('<script>alert(1)</script>A & B');
  expect(root.querySelector('svg')!.getAttribute('viewBox')).toBe('-10 -20 400 200');
  expect(root.querySelector('style')!.textContent).toBe('.label{fill:red}');
  const [, , width, height] = root.getAttribute('viewBox')!.split(' ').map(Number);
  expect(width).toBeGreaterThan(400); expect(height).toBeGreaterThan(200);
  expect(frameExportSvg(svg, { title: 'Unused' })).toBe(svg);
});

it('wraps unbroken Unicode titles and freezes a dark frame without changing the diagram', () => {
  const title = '🌿'.repeat(100);
  const root = new DOMParser().parseFromString(frameExportSvg(svg, { frame: true, title }, true), 'image/svg+xml').documentElement;
  const lines = [...root.querySelectorAll(':scope > text')];
  expect(lines.length).toBeGreaterThan(1);
  expect(lines.map(line => line.textContent).join('')).not.toMatch(/[\ud800-\udbff](?![\udc00-\udfff])/u);
  expect(root.querySelector('rect')!.getAttribute('fill')).toBe('#101722');
  expect(root.querySelector(':scope > svg text')!.textContent).toBe('Diagram');
});
