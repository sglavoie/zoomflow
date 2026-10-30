import { diskVersion, refreshDiskVersion, rememberDiskVersion } from './disk-version';

const databaseName = 'zoomflow.files';
const storeName = 'handles';
type Stored = { handle: FileSystemFileHandle; modified?: number };
type PermissionHandle = FileSystemFileHandle & {
  queryPermission?: (options: { mode: 'readwrite' }) => Promise<PermissionState>;
  requestPermission?: (options: { mode: 'readwrite' }) => Promise<PermissionState>;
};

function openDatabase(name = databaseName) {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(name, 1);
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
  /** Keys set or removed since the page loaded; a restore that read them earlier must not bring them back. */
  private changed = new Set<string>();

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
    this.changed?.add(key); // Unset while the Map constructor adds initial entries.
    this.write((store) => store.put({ handle, modified: diskVersion(handle) } satisfies Stored, key));
    return this;
  }
  override delete(key: string) {
    const existed = super.delete(key);
    this.changed.add(key);
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
        if (typeof key !== 'string' || this.changed.has(key)) return;
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

/** Ask to write a handle restored after a reload; the browser prompts only during a user action such as Save.
 * Resolves `denied` only when the visitor refused: a dismissed prompt or a lost user action resolves `prompt`. */
export async function writePermission(handle: FileSystemFileHandle): Promise<PermissionState> {
  const permissions = handle as PermissionHandle;
  if (!permissions.queryPermission || !permissions.requestPermission) return 'granted';
  try {
    const state = await permissions.queryPermission({ mode: 'readwrite' });
    return state === 'granted' ? state : await permissions.requestPermission({ mode: 'readwrite' });
  } catch { return 'prompt'; }
}

/** Whether Zoomflow may write a handle now, without prompting; a visitor can grant it in site settings after refusing. */
export async function hasWritePermission(handle: FileSystemFileHandle) {
  const permissions = handle as PermissionHandle;
  if (!permissions.queryPermission) return true;
  try { return await permissions.queryPermission({ mode: 'readwrite' }) === 'granted'; }
  catch { return false; }
}

type DirectoryPermissions = FileSystemDirectoryHandle & {
  queryPermission?: (options: { mode: 'readwrite' }) => Promise<PermissionState>;
  requestPermission?: (options: { mode: 'readwrite' }) => Promise<PermissionState>;
};

/** The folder each project was opened from, by project id, kept in IndexedDB so new linked files can be created in
 * it after a reload. Like `FileHandles`, folders that cannot be stored stay for the page session only. */
export class DirectoryHandles extends Map<string, FileSystemDirectoryHandle> {
  private database?: Promise<IDBDatabase | undefined>;
  private restoring?: Promise<void>;
  private writes: Promise<unknown> = Promise.resolve();
  private changed = new Set<string>();

  private db() {
    this.database ??= (async () => { try { return await openDatabase('zoomflow.folders'); } catch { return undefined; } })();
    return this.database;
  }
  private write(change: (store: IDBObjectStore) => void) {
    this.writes = this.writes.then(async () => {
      const db = await this.db();
      if (!db) return;
      const transaction = db.transaction(storeName, 'readwrite');
      change(transaction.objectStore(storeName));
      await done(transaction);
    }).catch(() => { /* Unstorable folders still work for this page session. */ });
  }
  override set(project: string, handle: FileSystemDirectoryHandle) {
    super.set(project, handle);
    this.changed?.add(project); // Unset while the Map constructor adds initial entries.
    this.write((store) => store.put(handle, project));
    return this;
  }
  override delete(project: string) {
    const existed = super.delete(project);
    this.changed.add(project);
    this.write((store) => store.delete(project));
    return existed;
  }
  /** Bring back folders stored before a reload, once, removing those of projects that `keep` rejects. */
  restore(keep: (project: string) => boolean = () => true) {
    this.restoring ??= (async () => {
      try {
        const db = await this.db();
        if (!db) return;
        const store = db.transaction(storeName, 'readonly').objectStore(storeName);
        const [keys, values] = await Promise.all([store.getAllKeys(), store.getAll()].map((request) =>
          new Promise<unknown[]>((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); })));
        keys.forEach((key, index) => {
          const value = values[index] as FileSystemHandle | undefined;
          if (typeof key !== 'string' || this.changed.has(key)) return;
          if (!keep(key)) { this.write((store) => store.delete(key)); return; }
          if (value?.kind === 'directory') super.set(key, value as FileSystemDirectoryHandle);
        });
      } catch { /* New files fall back to drafts. */ }
    })();
    return this.restoring;
  }
  async ready() { await this.restoring; }
}

/** Reopening a folder can produce another handle to the same directory. Reserve names before any disk await,
 * including entry comparisons, since checking for a file then creating it is not atomic. */
const creatingFiles = new Set<{ folder: FileSystemDirectoryHandle; path: string }>();

/** Create the file at project `path` in `folder` with `source`, during a user action so the browser may ask to write
 * the folder. Resolves why it wrote nothing when the visitor refused or a file is already there or being created. */
export async function createProjectFile(folder: FileSystemDirectoryHandle, path: string, source: string): Promise<FileSystemFileHandle | 'refused' | 'exists'> {
  const request = { folder, path: path.normalize('NFC').toLowerCase() };
  const others = [...creatingFiles].filter(other => other.path === request.path);
  creatingFiles.add(request);
  try {
    for (const other of others) {
      if ((other.folder === folder || await folder.isSameEntry(other.folder)) && creatingFiles.has(other)) return 'exists';
    }
    const permissions = folder as DirectoryPermissions;
    if (permissions.queryPermission && permissions.requestPermission) {
      const state = await permissions.queryPermission({ mode: 'readwrite' }).catch(() => 'prompt' as const);
      if (state !== 'granted' && await permissions.requestPermission({ mode: 'readwrite' }).catch(() => 'denied' as const) !== 'granted') return 'refused';
    }
    const parts = path.split('/');
    let directory = folder;
    for (const part of parts.slice(0, -1)) directory = await directory.getDirectoryHandle(part, { create: true });
    const name = parts.at(-1)!;
    try {
      await directory.getFileHandle(name);
      return 'exists';
    } catch (error) {
      if (error instanceof DOMException && error.name === 'TypeMismatchError') return 'exists';
      if (!(error instanceof DOMException && error.name === 'NotFoundError')) throw error;
    }
    const handle = await directory.getFileHandle(name, { create: true });
    const writable = await handle.createWritable();
    try { await writable.write(source); await writable.close(); }
    catch (error) { await writable.abort().catch(() => {}); throw error; }
    await refreshDiskVersion(handle);
    return handle;
  } finally {
    creatingFiles.delete(request);
  }
}
