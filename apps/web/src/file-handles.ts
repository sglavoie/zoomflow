import { diskVersion, rememberDiskVersion } from './disk-version';

const databaseName = 'zoomflow.files';
const storeName = 'handles';
type Stored = { handle: FileSystemFileHandle; modified?: number };
type PermissionHandle = FileSystemFileHandle & {
  queryPermission?: (options: { mode: 'readwrite' }) => Promise<PermissionState>;
  requestPermission?: (options: { mode: 'readwrite' }) => Promise<PermissionState>;
};

function openDatabase() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(databaseName, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(storeName);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('File handle storage is blocked.'));
  });
}

const done = (transaction: IDBTransaction) => new Promise<void>((resolve, reject) => {
  transaction.oncomplete = () => resolve();
  transaction.onerror = transaction.onabort = () => reject(transaction.error);
});

/** Each draft's file handle, with its last known modification time, kept in IndexedDB so Save can write
 * back to the same file and detect outside changes after a reload. Handles that cannot be stored, such as
 * in browsers without file-system access, stay for the page session only. */
export class FileHandles extends Map<string, FileSystemFileHandle> {
  private database?: Promise<IDBDatabase | undefined>;
  private restoring?: Promise<boolean>;
  /** Writes apply in order, so a removal cannot be overtaken by the save before it. */
  private writes: Promise<unknown> = Promise.resolve();

  private db() {
    this.database ??= (async () => { try { return await openDatabase(); } catch { return undefined; } })();
    return this.database;
  }
  private write(change: (store: IDBObjectStore) => void) {
    this.writes = this.writes.then(async () => {
      const db = await this.db();
      if (!db) return;
      const transaction = db.transaction(storeName, 'readwrite');
      change(transaction.objectStore(storeName));
      await done(transaction);
    }).catch(() => { /* Unstorable handles still work for this page session. */ });
  }
  override set(key: string, handle: FileSystemFileHandle) {
    super.set(key, handle);
    this.write((store) => store.put({ handle, modified: diskVersion(handle) } satisfies Stored, key));
    return this;
  }
  override delete(key: string) {
    const existed = super.delete(key);
    this.write((store) => store.delete(key));
    return existed;
  }

  /** Bring back handles stored before a reload, once; removing a draft in any tab also removes its handle.
   * Handles set since the page loaded take precedence, and handles of drafts that `keep` rejects, such as
   * drafts lost with cleared site data, are removed. Resolves whether any handle was restored. */
  restore(keep: (key: string) => boolean = () => true) {
    this.restoring ??= this.load(keep);
    return this.restoring;
  }
  /** Settles once restored handles are in place, so opening or saving a file sees them. */
  async ready() { await this.restoring; }
  private async load(keep: (key: string) => boolean) {
    try {
      const db = await this.db();
      if (!db) return false;
      const transaction = db.transaction(storeName, 'readonly');
      const store = transaction.objectStore(storeName);
      const [keys, values] = await Promise.all([store.getAllKeys(), store.getAll()].map((request) =>
        new Promise<unknown[]>((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); })));
      let restored = false;
      keys.forEach((key, index) => {
        const value = values[index] as Partial<Stored> | undefined;
        if (typeof key !== 'string' || this.has(key)) return;
        if (!keep(key)) { this.write((store) => store.delete(key)); return; }
        if (value?.handle?.kind !== 'file') return;
        super.set(key, value.handle);
        if (typeof value.modified === 'number' && diskVersion(value.handle) === undefined) rememberDiskVersion(value.handle, { lastModified: value.modified });
        restored = true;
      });
      return restored;
    } catch { return false; }
  }
}

/** Ask to write a handle restored after a reload; the browser prompts only during a user action such as Save. */
export async function writePermission(handle: FileSystemFileHandle) {
  const permissions = handle as PermissionHandle;
  if (!permissions.queryPermission || !permissions.requestPermission) return true;
  try {
    return await permissions.queryPermission({ mode: 'readwrite' }) === 'granted'
      || await permissions.requestPermission({ mode: 'readwrite' }) === 'granted';
  } catch { return false; }
}
