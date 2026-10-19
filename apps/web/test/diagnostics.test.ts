import { expect, it } from 'vitest';
import { compilerDiagnostics, diagnosticLocation, lintDiagnostics } from '../src/diagnostics';

it('preserves every compiler file location without marking foreign text in the active editor', () => {
  const items = compilerDiagnostics(JSON.stringify([
    { range: 'main.d2,1:0:2-1:1:3', errmsg: 'Local problem' },
    { range: 'lib/other.d2,3:2:20-3:3:21', errmsg: 'Imported problem' },
  ]), 'a\nb', 'main.d2');
  expect(items[0].range).toEqual({ from: 2, to: 3 });
  expect(items[1]).toMatchObject({ filename: 'lib/other.d2', line: 4, column: 3 });
  expect(items[1].range).toBeUndefined();
  expect(diagnosticLocation(items[1], 'main.d2')).toBe('lib/other.d2:4:3');
});

it('does not invent source locations for general failures or unlocated lint', () => {
  const [compiler] = compilerDiagnostics(new Error('Layout failed'), 'a');
  const [lint] = lintDiagnostics([{ rule: 'orphan-board', severity: 'warning', board: 'root', message: 'No location' }], 'a', []);
  for (const item of [compiler, lint]) {
    expect(item.range).toBeUndefined();
    expect(diagnosticLocation(item, 'example.d2')).toBe('Source location unavailable');
  }
});

it('never substitutes a same-name local shape for an imported lint location', () => {
  const [item] = lintDiagnostics([{ rule: 'dangling-link', severity: 'error', board: 'root', shape: 'a', message: 'Broken link',
    range: 'lib/nodes.d2,0:0:0-0:1:1' }], 'a', [{ board: 'root', shape: 'a', from: 0, to: 1 }]);
  expect(item.filename).toBe('lib/nodes.d2');
  expect(item.range).toBeUndefined();
});
