import { expect, test } from 'vitest';
import { describeError, plural, safeFilename } from '../src/text';

test('plural counts nouns', () => {
  expect(plural(0, 'warning')).toBe('0 warnings');
  expect(plural(1, 'lint error')).toBe('1 lint error');
  expect(plural(2, 'board')).toBe('2 boards');
  expect(plural(2, 'child', 'children')).toBe('2 children');
});

test('errors are described without their constructor name', () => {
  expect(describeError(new Error('Choose a .d2 file.'))).toBe('Choose a .d2 file.');
  expect(describeError(new DOMException('Denied', 'NotAllowedError'))).toBe('Denied');
  expect(describeError('plain')).toBe('plain');
});

test('download names keep spaces and replace path characters', () => {
  expect(safeFilename('Checkout flow')).toBe('Checkout flow');
  expect(safeFilename('lib/nodes.d2')).toBe('lib_nodes.d2');
  expect(safeFilename('a:b?')).toBe('a_b_');
  expect(safeFilename('  ')).toBe('diagram');
});
