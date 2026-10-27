// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest';
import { FileHandles } from '../src/file-handles';

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
