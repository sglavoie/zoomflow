import { describe, expect, it } from 'vitest';
import { EditorState } from '@codemirror/state';
import { aiChanges } from '../src/ai-changes';

function apply(before: string, after: string) {
  const state = EditorState.create({ doc: before });
  const changes = state.changes(aiChanges(before, after));
  expect(changes.apply(state.doc).toString()).toBe(after);
  return changes;
}

describe('AI source changes', () => {
  it('separates distant edits and leaves the unchanged middle out of the highlights', () => {
    const changes = apply('a: First\nb: Kept\nc: Last\n', 'a: Updated\nb: Kept\nc: Changed\n');
    const ranges: string[] = [];
    changes.iterChanges((_a, _b, _c, _d, inserted) => ranges.push(inserted.toString()));
    expect(ranges).toEqual(['Updated', 'Changed']);
  });
  it('handles additions, deletions, empty documents, Unicode and repeated lines', () => {
    for (const [before, after] of [
      ['', 'hello: 🌍\n'], ['a\nb\nc\n', 'a\nc\n'], ['a\nb\n', 'a\nb'], ['a\nb', 'a\nb\n'],
      ['a\nb', ''], ['a\nb\na\nb\nc', 'b\na\nb\na\nc'], ['a: 🌍', 'a: 🌎'], ['same', 'same'],
    ]) apply(before, after);
  });
  it('bounds expensive rewrites without changing the result or common edges', () => {
    const before = `first\n${Array.from({ length: 2000 }, (_, i) => `old${i}`).join('\n')}\nlast`;
    const after = `first\n${Array.from({ length: 2000 }, (_, i) => `new${i}`).join('\n')}\nlast`;
    const changes = apply(before, after);
    expect(changes.mapPos(2)).toBe(2);
    expect(changes.mapPos(before.length - 2)).toBe(after.length - 2);
  });
  it('reconstructs varied edits among repeated lines', () => {
    let seed = 17;
    const random = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32;
    for (let i = 0; i < 200; i++) {
      const lines = Array.from({ length: 30 }, () => `${Math.floor(random() * 8)}\n`);
      const before = lines.join('');
      for (let edit = 0; edit < 8; edit++) lines.splice(Math.floor(random() * lines.length), Math.floor(random() * 3), `${random()}\n`);
      apply(before, lines.join(''));
    }
  });
});
