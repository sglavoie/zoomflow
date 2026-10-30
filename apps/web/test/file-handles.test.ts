// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest';
import { createProjectFile, DirectoryHandles, FileHandles } from '../src/file-handles';

/** A minimal IndexedDB whose single store reads a snapshot and answers on a later task, like the real one. */
function fakeIndexedDb(rows: Map<string, unknown>) {
  const later = (request: { result?: unknown; onsuccess?: () => void }, result?: unknown) => {
    setTimeout(() => { request.result = result; request.onsuccess?.(); });
    return request;
  };
  const db = {
    transaction: () => {
      const transaction: { oncomplete?: () => void; objectStore: () => object } = {
        objectStore: () => ({
          getAllKeys: () => later({}, [...rows.keys()]),
          getAll: () => later({}, [...rows.values()]),
          put: (value: unknown, key: string) => later({}, rows.set(key, value)),
          delete: (key: string) => later({}, rows.delete(key)),
        }),
      };
      setTimeout(() => transaction.oncomplete?.(), 1);
      return transaction;
    },
  };
  return { open: () => later({}, db) };
}

afterEach(() => { vi.unstubAllGlobals(); });

it('does not restore a handle removed or replaced while the restore was reading', async () => {
  const stored = (name: string) => ({ handle: { kind: 'file', name } as FileSystemFileHandle });
  const rows = new Map<string, unknown>([['file:gone', stored('gone.d2')], ['file:kept', stored('kept.d2')], ['file:new', stored('old.d2')]]);
  vi.stubGlobal('indexedDB', fakeIndexedDb(rows));
  const handles = new FileHandles();
  const restored = handles.restore();
  handles.delete('file:gone');
  const replacement = { kind: 'file', name: 'new.d2' } as FileSystemFileHandle;
  handles.set('file:new', replacement);
  await expect(restored).resolves.toBe(true);
  expect(handles.has('file:gone')).toBe(false);
  expect(handles.get('file:new')).toBe(replacement);
  expect(handles.get('file:kept')?.name).toBe('kept.d2');
});

it('keeps each project\'s folder, and drops folders of removed projects when restoring', async () => {
  const folder = (name: string) => ({ kind: 'directory', name }) as FileSystemDirectoryHandle;
  const rows = new Map<string, unknown>([['kept', folder('atlas')], ['gone', folder('old')], ['replaced', folder('before')]]);
  vi.stubGlobal('indexedDB', fakeIndexedDb(rows));
  const folders = new DirectoryHandles();
  const restoring = folders.restore(project => project !== 'gone');
  const replacement = folder('after');
  folders.set('replaced', replacement);
  await restoring;
  expect(folders.get('kept')?.name).toBe('atlas');
  expect(folders.has('gone')).toBe(false);
  expect(folders.get('replaced')).toBe(replacement);
  await vi.waitFor(() => expect(rows.has('gone')).toBe(false));
  expect(rows.get('replaced')).toBe(replacement);
});

/** A folder in memory with the parts of the File System Access API that creating a file uses. */
function memoryFolder(files: Map<string, string>, permission: PermissionState = 'granted', prefix = ''): FileSystemDirectoryHandle {
  const notFound = () => Promise.reject(new DOMException('Not found', 'NotFoundError'));
  return {
    kind: 'directory',
    queryPermission: async () => permission === 'granted' ? 'granted' : 'prompt',
    requestPermission: async () => permission,
    getDirectoryHandle: async (name: string) => memoryFolder(files, permission, `${prefix}${name}/`),
    getFileHandle: async (name: string, options?: { create?: boolean }) => {
      const path = `${prefix}${name}`;
      if (!files.has(path) && !options?.create) return notFound();
      if (!files.has(path)) files.set(path, '');
      return {
        kind: 'file', name,
        getFile: async () => ({ lastModified: 1, text: async () => files.get(path) }),
        createWritable: async () => {
          let text = '';
          return { write: async (chunk: string) => { text += chunk; }, close: async () => { files.set(path, text); }, abort: async () => {} };
        },
      };
    },
  } as unknown as FileSystemDirectoryHandle;
}

it('creates new project files in their folder, without overwriting or writing without permission', async () => {
  const files = new Map([['index.d2', 'a']]);
  const created = await createProjectFile(memoryFolder(files), 'work/Plan.d2', '# Plan\n');
  expect(typeof created === 'object' && created.name).toBe('Plan.d2');
  expect(files.get('work/Plan.d2')).toBe('# Plan\n');
  await expect(createProjectFile(memoryFolder(files), 'index.d2', 'b')).resolves.toBe('exists');
  expect(files.get('index.d2')).toBe('a');
  await expect(createProjectFile(memoryFolder(files, 'denied'), 'New.d2', 'c')).resolves.toBe('refused');
  expect(files.has('New.d2')).toBe(false);
});

it.each(['work/Plan.d2', 'work/plan.d2'])('does not overwrite a project file another creation is still writing (%s)', async (path) => {
  const files = new Map<string, string>();
  const folder = memoryFolder(files);
  const [first, second] = await Promise.all([
    createProjectFile(folder, 'work/Plan.d2', 'first diagram'),
    createProjectFile(folder, path, 'second diagram'),
  ]);
  expect(typeof first).toBe('object');
  expect(second).toBe('exists');
  expect(files.get('work/Plan.d2')).toBe('first diagram');
  await expect(createProjectFile(folder, 'work/Other.d2', 'other diagram')).resolves.toMatchObject({ name: 'Other.d2' });
});

it('releases a reserved project filename when creation fails', async () => {
  const files = new Map<string, string>();
  const folder = memoryFolder(files);
  vi.spyOn(folder, 'getFileHandle').mockRejectedValueOnce(new DOMException('Cannot read', 'NotAllowedError'));
  await expect(createProjectFile(folder, 'Plan.d2', 'first attempt')).rejects.toThrow('Cannot read');
  await expect(createProjectFile(folder, 'Plan.d2', 'retry')).resolves.toMatchObject({ name: 'Plan.d2' });
  expect(files.get('Plan.d2')).toBe('retry');
});
