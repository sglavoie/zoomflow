import { describe, expect, it } from 'vitest';
import { clampBox, revealBox, type Box } from '../src/viewport';

const base: Box = { x: 0, y: 0, width: 100, height: 50 };

describe('clampBox', () => {
  it('keeps a zoomed view inside the fitted diagram', () => {
    expect(clampBox(base, { x: -20, y: -5, width: 50, height: 25 })).toEqual({ x: 0, y: 0, width: 50, height: 25 });
    expect(clampBox(base, { x: 80, y: 40, width: 50, height: 25 })).toEqual({ x: 50, y: 25, width: 50, height: 25 });
    expect(clampBox(base, { x: 10, y: 5, width: 50, height: 25 })).toEqual({ x: 10, y: 5, width: 50, height: 25 });
  });

  it('keeps a zoomed-out view within its overhang', () => {
    expect(clampBox(base, { x: 10, y: 0, width: 200, height: 100 })).toEqual({ x: 0, y: 0, width: 200, height: 100 });
    expect(clampBox(base, { x: -150, y: -80, width: 200, height: 100 })).toEqual({ x: -100, y: -50, width: 200, height: 100 });
    expect(clampBox(base, { x: -40, y: -20, width: 200, height: 100 })).toEqual({ x: -40, y: -20, width: 200, height: 100 });
  });

  it('respects a base with an offset origin', () => {
    const offset = { x: -100, y: -100, width: 100, height: 100 };
    expect(clampBox(offset, { x: 0, y: 0, width: 50, height: 50 })).toEqual({ x: -50, y: -50, width: 50, height: 50 });
  });
});

describe('revealBox', () => {
  const box: Box = { x: 0, y: 0, width: 50, height: 25 };
  const available = { width: 50, height: 25 };

  it('does not move when the target is already visible', () => {
    expect(revealBox(base, box, { x: 10, y: 5, width: 10, height: 5 }, available, 0.1)).toEqual(box);
  });

  it('pans the minimum distance to bring a target into view at the same zoom', () => {
    expect(revealBox(base, box, { x: 60, y: 5, width: 10, height: 5 }, available, 0.1)).toEqual({ x: 20, y: 0, width: 50, height: 25 });
    expect(revealBox(base, { ...box, x: 40, y: 20 }, { x: 0, y: 0, width: 10, height: 5 }, available, 0.1))
      .toEqual({ x: 0, y: 0, width: 50, height: 25 });
  });

  it('zooms out just enough to fit a larger target, keeping the aspect ratio', () => {
    expect(revealBox(base, box, { x: 0, y: 0, width: 100, height: 10 }, available, 0.1)).toEqual({ x: 0, y: -12.5, width: 100, height: 50 });
  });

  it('never zooms out beyond the minimum zoom', () => {
    const result = revealBox(base, box, { x: 0, y: 0, width: 10_000, height: 10 }, available, 0.1);
    expect(result.width).toBe(1000);
    expect(result.height).toBe(500);
  });

  it('frames against the letterboxed viewport, not the nominal box', () => {
    // A wide viewport shows more than the box: a target beside it fits without zooming out.
    const result = revealBox(base, box, { x: 50, y: 5, width: 20, height: 5 }, { width: 80, height: 25 }, 0.1);
    expect(result.width).toBe(50);
    expect(result.x).toBe(5);
  });
});
