import { expect, test } from 'vitest';
import { ChangeSet, EditorSelection, Text } from '@codemirror/state';
import { formatChanges } from '../src/format-changes';

test('formatting maps a reversed selection inside repeated nodes and Unicode labels', () => {
  const before = 'alpha:{label:One}\nbeta:{label:你好}\ngamma:{label:One}';
  const after = 'alpha: {label: One}\nbeta: {label: 你好}\ngamma: {label: One}\n';
  const change = ChangeSet.of(formatChanges(before, after), before.length);
  const start = before.indexOf('你好');
  const selection = EditorSelection.single(start + 2, start).map(change).main;
  expect(change.apply(Text.of(before.split('\n'))).toString()).toBe(after);
  expect(selection.anchor).toBe(after.indexOf('你好') + 2);
  expect(selection.head).toBe(after.indexOf('你好'));
});

test('large formatting operations preserve a cursor in the middle of the document', () => {
  const before = Array.from({ length: 2000 }, (_, i) => `node${i}:{label:Same}`).join('\n');
  const after = before.replaceAll(':{', ': {').replaceAll('label:', 'label: ') + '\n';
  const changes = ChangeSet.of(formatChanges(before, after), before.length);
  expect(changes.mapPos(before.indexOf('node1000') + 4)).toBe(after.indexOf('node1000') + 4);
  expect(changes.apply(Text.of(before.split('\n'))).toString()).toBe(after);
});

test('substantive AI edits still replace content correctly', () => {
  const before = 'old: Previous\n', after = 'new: Replacement\n';
  expect(ChangeSet.of(formatChanges(before, after), before.length).apply(Text.of(before.split('\n'))).toString()).toBe(after);
});

test('removing redundant punctuation does not move a cursor to another node', () => {
  const before = 'empty: {}\na: { label:One; }\nb:{label:Two}';
  const after = 'empty\na: {label: One}\nb: {label: Two}\n';
  const changes = ChangeSet.of(formatChanges(before, after), before.length);
  expect(changes.mapPos(before.indexOf('Two') + 1)).toBe(after.indexOf('Two') + 1);
  expect(changes.apply(Text.of(before.split('\n'))).toString()).toBe(after);
});
