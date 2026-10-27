// @vitest-environment happy-dom
import { beforeEach, expect, it, vi } from 'vitest';
import type { FileHandles } from '../src/file-handles';
import { writePermission } from '../src/file-handles';
import { setupSaveFile } from '../src/save-file';

type Permission = { query: PermissionState; request: PermissionState | Error };

/** A file handle whose permission answers and writes the test controls. */
function fakeHandle(name: string, permission: Permission) {
  const disk = { written: [] as string[], prompts: 0, writeError: undefined as Error | undefined, abortError: false, onWrite: () => {} };
  const handle = {
    kind: 'file', name,
    queryPermission: async () => permission.query,
    requestPermission: async () => {
      disk.prompts++;
      if (permission.request instanceof Error) throw permission.request;
      return permission.request;
    },
    getFile: async () => new File(['a: A'], name, { lastModified: 1 }),
    createWritable: async () => ({
      write: async (source: string) => { disk.onWrite(); if (disk.writeError) throw disk.writeError; disk.written.push(source); },
      close: async () => {},
      abort: async () => { if (disk.abortError) throw new TypeError('Cannot abort a closed stream'); },
    }),
  } as unknown as FileSystemFileHandle;
  return { handle, disk };
}

let downloads = 0;
beforeEach(() => {
  downloads = 0;
  document.body.innerHTML = '<button id="save-file"></button><button id="save-file-b"></button><button id="save-source"></button>';
  document.querySelector<HTMLButtonElement>('#save-source')!.onclick = () => { downloads++; };
});

function setup(handles: Map<string, FileSystemFileHandle>, id = 'save-file') {
  const button = document.querySelector<HTMLButtonElement>(`#${id}`)!;
  const state = { key: 'file:doc' as string | undefined, activity: '' };
  const fileHandles = Object.assign(handles, { ready: async () => {} }) as unknown as FileHandles;
  setupSaveFile(button, {
    fileHandles,
    picker: () => ({ markDiskSaved: (key: string, _source: string, name: string) => ({ key, name }) }) as never,
    key: () => state.key, name: () => 'doc.d2', source: () => 'a: Mine',
    adopt: () => {}, setActivity: (message) => { state.activity = message; }, activity: () => state.activity,
  });
  const save = async () => {
    button.click();
    await vi.waitFor(() => expect(button.disabled).toBe(false));
  };
  return { state, save };
}

it('resolves denied only when the visitor refused writing', async () => {
  await expect(writePermission(fakeHandle('a.d2', { query: 'granted', request: 'denied' }).handle)).resolves.toBe('granted');
  await expect(writePermission(fakeHandle('a.d2', { query: 'prompt', request: 'denied' }).handle)).resolves.toBe('denied');
  // Losing the user action throws; that is not a refusal.
  const lost = new DOMException('Must be handling a user gesture', 'SecurityError');
  await expect(writePermission(fakeHandle('a.d2', { query: 'prompt', request: lost }).handle)).resolves.toBe('prompt');
  await expect(writePermission({ name: 'a.d2' } as FileSystemFileHandle)).resolves.toBe('granted');
});

it('asks again after a dismissed permission prompt', async () => {
  const { handle, disk } = fakeHandle('doc.d2', { query: 'prompt', request: 'prompt' });
  const { state, save } = setup(new Map([['file:doc', handle]]));
  await save();
  expect(state.activity).toBe('Zoomflow needs permission to write doc.d2; choose where to save.');
  await save();
  expect([disk.prompts, downloads]).toEqual([2, 2]);
});

it('stops asking after a refusal until permission is granted or another file is opened', async () => {
  const permission: Permission = { query: 'prompt', request: 'denied' };
  const { handle, disk } = fakeHandle('doc.d2', permission);
  const handles = new Map([['file:doc', handle]]);
  const { state, save } = setup(handles);
  await save();
  await save();
  expect(state.activity).toBe('Zoomflow may not write doc.d2; choose where to save.');
  expect([disk.prompts, downloads]).toEqual([1, 2]);
  // Granted in site settings: Save writes back without prompting.
  permission.query = 'granted';
  await save();
  expect([disk.prompts, disk.written]).toEqual([1, ['a: Mine']]);
  // Reopening the draft from another file asks about that file.
  permission.query = 'prompt';
  const other = fakeHandle('doc.d2', { query: 'prompt', request: 'granted' });
  handles.set('file:doc', other.handle);
  await save();
  expect([other.disk.prompts, other.disk.written]).toEqual([1, ['a: Mine']]);
});

it('remembers a refusal in every pane that shows the draft', async () => {
  const { handle, disk } = fakeHandle('doc.d2', { query: 'prompt', request: 'denied' });
  const handles = new Map([['file:doc', handle]]);
  await setup(handles).save();
  const other = setup(handles, 'save-file-b');
  await other.save();
  expect(other.state.activity).toBe('Zoomflow may not write doc.d2; choose where to save.');
  expect([disk.prompts, downloads]).toEqual([1, 2]);
});

it('reports a write error over a failed abort', async () => {
  const { handle, disk } = fakeHandle('doc.d2', { query: 'granted', request: 'granted' });
  disk.writeError = new Error('Disk full');
  disk.abortError = true;
  const { state, save } = setup(new Map([['file:doc', handle]]));
  await save();
  expect(state.activity).toBe('Could not save file: Disk full');
});

it('names the file when its save fails after switching documents', async () => {
  const { handle, disk } = fakeHandle('doc.d2', { query: 'granted', request: 'granted' });
  disk.writeError = new Error('Disk full');
  const { state, save } = setup(new Map([['file:doc', handle]]));
  disk.onWrite = () => { state.key = 'file:other'; };
  await save();
  expect(state.activity).toBe('Could not save doc.d2: Disk full');
});
