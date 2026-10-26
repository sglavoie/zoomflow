// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { rasterSize } from '../src/export';

const root = (attributes: string) =>
  new DOMParser().parseFromString(`<svg xmlns="http://www.w3.org/2000/svg" ${attributes}/>`, 'image/svg+xml').documentElement;

describe('rasterSize', () => {
  it('keeps the native viewBox size, rounded up, within canvas limits', () => {
    expect(rasterSize(root('viewBox="-10 -10 800.4 600"'))).toMatchObject({ width: 801, height: 600 });
    expect(rasterSize(root('width="120" height="80"'))).toMatchObject({ width: 120, height: 80, native: [120, 80] });
  });

  it('scales a side beyond 16384 pixels down, keeping the aspect ratio', () => {
    expect(rasterSize(root('viewBox="0 0 40000 1000"'))).toMatchObject({ width: 16384, height: 409 });
    expect(rasterSize(root('viewBox="0 0 500 32768"'))).toMatchObject({ width: 250, height: 16384 });
  });

  it('scales a large area down to 64 megapixels', () => {
    const { width, height } = rasterSize(root('viewBox="0 0 16000 16000"'));
    expect(width).toBe(height);
    expect(width * height).toBeLessThanOrEqual(64_000_000);
    expect(width).toBe(8000);
  });

  it('names a missing or invalid viewBox instead of a size limit', () => {
    for (const attributes of ['', 'viewBox="0 0 0 10"', 'viewBox="0 0 abc 10"', 'viewBox="0 0"', 'width="100%" height="auto"']) {
      expect(() => rasterSize(root(attributes))).toThrow('Diagram has no valid size: its SVG viewBox is missing or invalid.');
    }
  });
});
