import { describe, expect, it } from 'vitest';
import { splitHitArea, type Rect } from '../src/link-cues';

const rect = (left: number, top: number, right: number, bottom: number): Rect => ({ left, top, right, bottom });
const own = rect(100, 100, 120, 110);
const expanded = rect(88, 83, 132, 127);

describe('splitHitArea', () => {
  it('keeps the full expansion when nothing is nearby', () => {
    expect(splitHitArea(own, expanded, [])).toEqual(expanded);
    expect(splitHitArea(own, expanded, [{ bounds: rect(200, 0, 220, 10), area: rect(200, 0, 220, 10) }])).toEqual(expanded);
  });

  it('splits the gap at its midpoint with a neighbor on each side', () => {
    const right = rect(124, 100, 150, 110);
    expect(splitHitArea(own, expanded, [{ bounds: right, area: right }])).toEqual({ ...expanded, right: 122 });
    const left = rect(60, 100, 96, 110);
    expect(splitHitArea(own, expanded, [{ bounds: left, area: left }])).toEqual({ ...expanded, left: 98 });
    const below = rect(100, 114, 120, 130);
    expect(splitHitArea(own, expanded, [{ bounds: below, area: below }])).toEqual({ ...expanded, bottom: 112 });
    const above = rect(100, 80, 120, 90);
    expect(splitHitArea(own, expanded, [{ bounds: above, area: above }])).toEqual({ ...expanded, top: 95 });
  });

  it('tests overlap against the obstacle area but splits against its bounds', () => {
    // A small linked neighbor is itself expanded; only that expansion reaches this link.
    const bounds = rect(140, 100, 150, 110);
    expect(splitHitArea(own, expanded, [{ bounds, area: rect(130, 90, 160, 120) }])).toEqual({ ...expanded, right: 130 });
  });

  it('falls back to the shape when an obstacle overlaps it', () => {
    const container = rect(50, 50, 200, 200);
    expect(splitHitArea(own, expanded, [{ bounds: container, area: container }])).toEqual(own);
  });

  it('does not mutate its inputs', () => {
    const copy = { ...expanded };
    splitHitArea(own, expanded, [{ bounds: rect(124, 100, 150, 110), area: rect(124, 100, 150, 110) }]);
    expect(expanded).toEqual(copy);
  });
});
