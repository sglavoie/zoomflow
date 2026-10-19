import type { ChangeSpec } from '@codemirror/state';

/** A bounded line diff keeps separate AI edits separate. Large rewrites fall
 * back to a single replacement; common edges are always retained. */
export function aiChanges(before: string, after: string): ChangeSpec[] {
  if (before === after) return [];
  const a = before.match(/[^\n]*\n|[^\n]+$/g) ?? [];
  const b = after.match(/[^\n]*\n|[^\n]+$/g) ?? [];
  let prefix = 0, endA = a.length, endB = b.length;
  while (prefix < endA && prefix < endB && a[prefix] === b[prefix]) prefix++;
  while (endA > prefix && endB > prefix && a[endA - 1] === b[endB - 1]) { endA--; endB--; }
  const n = endA - prefix, m = endB - prefix;
  const trace: Map<number, number>[] = [];
  const frontier = new Map<number, number>([[1, 0]]);
  let matches: [number, number][] = [];
  search: for (let d = 0; d <= Math.min(n + m, 256); d++) {
    trace.push(new Map(frontier));
    for (let k = -d; k <= d; k += 2) {
      let x = k === -d || k !== d && (frontier.get(k - 1) ?? -1) < (frontier.get(k + 1) ?? -1)
        ? frontier.get(k + 1) ?? 0 : (frontier.get(k - 1) ?? 0) + 1;
      let y = x - k;
      while (x < n && y < m && a[prefix + x] === b[prefix + y]) { x++; y++; }
      frontier.set(k, x);
      if (x < n || y < m) continue;
      for (let depth = d; depth >= 0; depth--) {
        const previous = trace[depth];
        const diagonal = x - y;
        const previousK = diagonal === -depth || diagonal !== depth &&
          (previous.get(diagonal - 1) ?? -1) < (previous.get(diagonal + 1) ?? -1) ? diagonal + 1 : diagonal - 1;
        const previousX = previous.get(previousK) ?? 0;
        const previousY = previousX - previousK;
        while (x > previousX && y > previousY) matches.push([prefix + --x, prefix + --y]);
        x = previousX; y = previousY;
      }
      matches.reverse();
      break search;
    }
  }
  matches = [...Array.from({ length: prefix }, (_, i): [number, number] => [i, i]), ...matches,
    ...Array.from({ length: a.length - endA }, (_, i): [number, number] => [endA + i, endB + i]), [a.length, b.length]];
  const changes: ChangeSpec[] = [];
  let left = 0, right = 0, offset = 0;
  for (const [nextA, nextB] of matches) {
    const removed = a.slice(left, nextA).join('');
    const inserted = b.slice(right, nextB).join('');
    if (removed !== inserted) {
      let start = 0, oldEnd = removed.length, newEnd = inserted.length;
      while (start < oldEnd && start < newEnd && removed[start] === inserted[start]) start++;
      while (oldEnd > start && newEnd > start && removed[oldEnd - 1] === inserted[newEnd - 1]) { oldEnd--; newEnd--; }
      changes.push({ from: offset + start, to: offset + oldEnd, insert: inserted.slice(start, newEnd) });
    }
    offset += removed.length + (a[nextA]?.length ?? 0);
    left = nextA + 1; right = nextB + 1;
  }
  return changes;
}
