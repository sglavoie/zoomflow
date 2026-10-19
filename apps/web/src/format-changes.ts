import type { ChangeSpec } from '@codemirror/state';

/** Keep unchanged characters in the transaction so CodeMirror can map cursors,
 * selections and scroll anchors. D2 can also remove trailing semicolons and empty maps. */
export function formatChanges(before: string, after: string): ChangeSpec[] {
  const trivia = before.replace(/\s/g, '') === after.replace(/\s/g, '') ? /\s/
    : before.replace(/[\s;:{}]/g, '') === after.replace(/[\s;:{}]/g, '') ? /[\s;:{}]/ : undefined;
  if (trivia) {
    const changes: ChangeSpec[] = [];
    let a = 0, b = 0;
    while (a < before.length || b < after.length) {
      const from = a, start = b;
      while (a < before.length && trivia.test(before[a])) a++;
      while (b < after.length && trivia.test(after[b])) b++;
      if (before.slice(from, a) !== after.slice(start, b)) changes.push({ from, to: a, insert: after.slice(start, b) });
      if (a < before.length) { a++; b++; }
    }
    return changes;
  }
  // Retain unchanged edges when formatting also changes substantive content.
  let from = 0, end = before.length, nextEnd = after.length;
  while (from < end && from < nextEnd && before[from] === after[from]) from++;
  while (end > from && nextEnd > from && before[end - 1] === after[nextEnd - 1]) { end--; nextEnd--; }
  return [{ from, to: end, insert: after.slice(from, nextEnd) }];
}
