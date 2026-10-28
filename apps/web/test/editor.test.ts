// @vitest-environment happy-dom
import { expect, it } from 'vitest';
import type { SourceDiagnostic } from '../src/diagnostics';
import { SourceEditor } from '../src/editor';

it('drops the markers a document showed before it was reopened', () => {
  const parent = document.createElement('div');
  document.body.append(parent);
  const editor = new SourceEditor(parent, { panelId: 'p', changed() {}, selected() {}, format() {}, reveal() {} });
  const warning = { severity: 'warning', message: 'missing', filename: 'index', range: { from: 0, to: 1 } } as SourceDiagnostic;
  editor.open('x', 'a -> b');
  editor.diagnostics([warning], 'index', 'x', () => true, () => {});
  expect(parent.querySelectorAll('.cm-lintRange')).toHaveLength(1);
  editor.open('y', 'c');
  editor.open('x', 'a -> b');
  expect(parent.querySelectorAll('.cm-lintRange')).toHaveLength(0);
});
