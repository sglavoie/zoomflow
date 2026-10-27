// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { setupExamplePicker, type DraftState, type PaneId } from '../src/example-picker';

const page = readFileSync(join(import.meta.dirname, '../index.html'), 'utf8');

function picker() {
  document.body.innerHTML = page.slice(page.indexOf('<body'), page.lastIndexOf('</body>')).replace(/^<body[^>]*>/, '').replace(/<script[\s\S]*?<\/script>/g, '');
  const shown: Partial<Record<PaneId, string>> = {};
  const states: Partial<Record<PaneId, DraftState>> = {};
  const api = setupExamplePicker({ readSource: pane => shown[pane] ?? '', open: (pane, document) => { shown[pane] = document?.source; },
    onState: (pane, state) => { states[pane] = state; }, forget() {}, checkpoint: () => () => {}, focusPane() {}, openAtlas() {} });
  return { api, states, shown };
}

it('opens a folder read from disk as saved, and a draft atlas that is not on disk as unsaved', () => {
  const { api, states, shown } = picker();
  const files = [{ path: 'index.d2', source: 'home: Home\n' }];
  const folder = api.rememberFolder('notes', files);
  shown.a = folder.source;
  api.refresh();
  expect(states.a).toMatchObject({ dirty: false, identity: { key: folder.key } });
  const draft = api.rememberFolder('atlas', files, undefined, false);
  shown.a = draft.source;
  api.refresh();
  expect(states.a).toMatchObject({ dirty: true, identity: { key: draft.key } });
  // A second draft atlas never reuses the first, which may hold edits only the browser keeps.
  expect(api.rememberFolder('atlas', files, undefined, false).projectId).not.toBe(draft.projectId);
});
