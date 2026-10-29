// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';
import { DraftStore } from '../src/draft-store';
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

it('opens a single file as a new draft rather than taking over a recovered project copy', () => {
  localStorage.clear();
  const file = { key: 'project:p1:index.d2', name: 'index.d2', title: 'notes/index.d2', description: 'Project file', projectId: 'p1', path: 'index.d2' };
  const seed = new DraftStore(localStorage, 'seed');
  seed.load();
  seed.save([{ ...file, source: 'a', baseline: 'a' }], file.key);
  // Two tabs edit the file at once; the one that saved leaves a clean recovered copy.
  const saved = new DraftStore(localStorage, 'saved'), edited = new DraftStore(localStorage, 'edited');
  saved.load();
  edited.load();
  const now = vi.spyOn(Date, 'now').mockReturnValue(1000);
  saved.save([{ ...file, source: 'x: X\n', baseline: 'x: X\n' }], file.key);
  // The later edit wins on reload, so the saved version becomes the copy.
  now.mockReturnValue(2000);
  edited.save([{ ...file, source: 'y: Y\n', baseline: 'a' }], file.key);
  now.mockRestore();
  const { api, states, shown } = picker();
  const key = api.rememberFile('index.d2', 'x: X\n', 'x: X\n', () => undefined);
  shown.a = 'x: X\n';
  api.refresh();
  expect(key).not.toContain('recovered');
  expect(states.a?.identity.projectId).toBeUndefined();
});

it('returns to a recovered copy of a project file by its key, not to the file it copies', () => {
  localStorage.clear();
  const file = { key: 'project:p1:index.d2', name: 'index.d2', title: 'notes/index.d2', description: 'Project file', projectId: 'p1', path: 'index.d2' };
  const other = { key: 'project:p1:other.d2', name: 'other.d2', title: 'notes/other.d2', description: 'Project file', projectId: 'p1', path: 'other.d2', source: 'o', baseline: 'o' };
  const seed = new DraftStore(localStorage, 'seed');
  seed.load();
  seed.save([{ ...file, source: 'a', baseline: 'a' }, other], file.key);
  const saved = new DraftStore(localStorage, 'saved'), edited = new DraftStore(localStorage, 'edited');
  saved.load();
  edited.load();
  const now = vi.spyOn(Date, 'now').mockReturnValue(1000);
  saved.save([{ ...file, source: 'x: {link: ./other.d2}\n', baseline: 'a' }, other], file.key);
  now.mockReturnValue(2000);
  edited.save([{ ...file, source: 'y: Y\n', baseline: 'a' }, other], file.key);
  now.mockRestore();
  const recovered = `file:recovered:${encodeURIComponent(file.key)}:saved-1`;
  localStorage.setItem('zoomflow.selection.v2', recovered);
  const { api, shown } = picker();
  expect(api.currentKey('a')).toBe(recovered);
  shown.a = api.initial.source;
  // Following a link from the copy, then going back the way it came.
  const path = api.inputPath('a');
  expect(api.selectProjectPath('a', 'other.d2')?.key).toBe(other.key);
  shown.a = 'o';
  expect(api.selectProjectPath('a', path, recovered)).toMatchObject({ key: recovered, source: 'x: {link: ./other.d2}\n' });
  // A copy removed since falls back to the file at that path.
  expect(api.selectProjectPath('a', path, 'file:recovered:gone:v1')?.key).toBe(file.key);
});
