import type { setupExamplePicker } from './example-picker';
import { changedOnDisk, refreshDiskVersion } from './disk-version';
import { hasWritePermission, writePermission, type FileHandles } from './file-handles';
import { describeError } from './text';
import { downloadSource } from './download';

type PickerWindow = Window & { showSaveFilePicker?: (options?: object) => Promise<FileSystemFileHandle> };
const pickerWindow = window as PickerWindow;

const moved = 'The file was moved or deleted; choose where to save.';
const inProgress = 'A save for this document is still in progress. Save again when it finishes.';
const fileInProgress = 'A save to this file is still in progress. Save again when it finishes.';

/** A document can move between panes while its write is pending. Each workspace shares these locks,
 * so an older write cannot finish after, and replace, a newer save started from the other pane.
 * Different drafts can also share a disk file, including through separate handles to the same entry. */
type PendingSave = { key: string; handle?: FileSystemFileHandle };
const pendingSaves = new WeakMap<FileHandles, Set<PendingSave>>();

/** The file each draft was refused writing to, shared by every pane; Save asks where to save instead of asking
 * again, until the visitor grants it elsewhere or opens the draft from another file. */
const refused = new Map<string, FileSystemFileHandle>();

/** Whether this browser can ask where to save a new file. */
export const canChooseSaveFile = () => Boolean(pickerWindow.showSaveFilePicker);

export type SaveFileTarget = {
  fileHandles: FileHandles;
  picker: () => ReturnType<typeof setupExamplePicker>;
  /** The document the pane shows now, if any. */
  key: () => string | undefined;
  name: () => string;
  source: () => string;
  /** The current revision was downloaded; later edits still need their own download. */
  downloaded: () => void;
  /** Update whichever pane now shows `key`, taking on the saved example's new identity. */
  adopt: (key: string, saved: { key: string; name: string }) => void;
  setActivity: (message: string, kind?: 'info' | 'error') => void;
  activity: () => string | null;
};

/** Save writes the source back to its file, asks for one, or falls back to a download. */
export function setupSaveFile(button: HTMLButtonElement, target: SaveFileTarget) {
  /** Save notices cleared once a save succeeds. */
  const notices = new Set([moved, inProgress, fileInProgress]);
  button.addEventListener('click', async () => {
    const key = target.key();
    if (!key) return;
    const pending = pendingSaves.get(target.fileHandles) ?? new Set<PendingSave>();
    pendingSaves.set(target.fileHandles, pending);
    if ([...pending].some(save => save.key === key)) { target.setActivity(inProgress); return; }
    const request: PendingSave = { key };
    pending.add(request);
    button.disabled = true;
    const source = target.source();
    const name = target.name();
    let saving: ReturnType<typeof setTimeout> | undefined;
    const notify = (message: string) => { notices.add(message); if (target.key() === key) target.setActivity(message); };
    async function reserveFile(handle: FileSystemFileHandle) {
      const others = [...pending].filter(save => save !== request && save.handle);
      // Reserve before comparing entries: a concurrent save must see this one while isSameEntry awaits.
      request.handle = handle;
      for (const other of others) {
        const entry = other.handle!;
        if ((entry === handle || await handle.isSameEntry(entry)) && pending.has(other) && other.handle === entry) {
          notify(fileInProgress);
          return false;
        }
      }
      return true;
    }
    try {
      await target.fileHandles.ready();
      let handle = target.fileHandles.get(key);
      // A handle restored after a reload needs permission again; without it, ask where to save.
      if (handle) {
        const permission = refused.get(key) === handle
          ? (await hasWritePermission(handle) ? 'granted' : 'denied')
          : await writePermission(handle);
        if (permission !== 'granted') {
          if (permission === 'denied') refused.set(key, handle);
          notify(permission === 'denied' ? `Zoomflow may not write ${handle.name}; choose where to save.`
            : `Zoomflow needs permission to write ${handle.name}; choose where to save.`);
          handle = undefined;
        }
      }
      if (handle && !await reserveFile(handle)) return;
      if (handle && await changedOnDisk(handle)) {
        const focused = document.activeElement;
        const overwrite = await target.picker().confirm('File changed on disk — overwrite?',
          `${handle.name} changed outside Zoomflow since it was opened or last saved. Saving replaces those changes with the source shown here.`,
          'Overwrite file', () => { if (focused instanceof HTMLElement && focused.isConnected) focused.focus({ preventScroll: true }); });
        if (!overwrite) {
          if (target.key() === key) target.setActivity('Save canceled. The file on disk is unchanged.');
          return;
        }
      }
      let writable: FileSystemWritableFileStream | undefined;
      if (handle) {
        try { writable = await handle.createWritable(); }
        catch (error) {
          // The file was moved or deleted on disk: forget it and ask where to save instead.
          if (!(error instanceof DOMException && error.name === 'NotFoundError')) throw error;
          target.fileHandles.delete(key);
          handle = undefined;
          request.handle = undefined;
          notify(moved);
        }
      }
      if (!handle && pickerWindow.showSaveFilePicker) {
        try {
          handle = await pickerWindow.showSaveFilePicker({ suggestedName: name,
            types: [{ description: 'D2 source', accept: { 'text/plain': ['.d2'] } }] });
        } catch (error) {
          // Answering the permission prompt can use up the click that opens the save dialog.
          if (!(error instanceof DOMException && error.name === 'SecurityError')) throw error;
          notify('Click Save again to choose where to save.');
          return;
        }
        if (!await reserveFile(handle)) return;
      }
      if (!handle) {
        const filename = downloadSource(source, name);
        if (target.key() === key) {
          if (target.source() === source) target.downloaded();
          target.setActivity(`Source download started: ${filename}`);
        }
        return;
      }
      saving = setTimeout(() => { if (target.key() === key) target.setActivity('Saving file…'); }, 700);
      writable ??= await handle.createWritable();
      try { await writable.write(source); await writable.close(); }
      // Aborting an already failed stream can reject too; report the write error instead.
      catch (error) { await writable.abort().catch(() => {}); throw error; }
      await refreshDiskVersion(handle);
      const saved = target.picker().markDiskSaved(key, source, handle.name);
      if (!saved) return; // The draft may have been removed while the file dialog was open.
      target.fileHandles.set(saved.key, handle);
      refused.delete(key);
      target.adopt(key, saved);
      if (target.key() === key && notices.has(target.activity() ?? '')) target.setActivity('');
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return;
      // Name the file when another document is open by now, so the failure is not mistaken for this one's.
      target.setActivity(target.key() === key ? `Could not save file: ${describeError(error)}`
        : `Could not save ${name}: ${describeError(error)}`, 'error');
    } finally {
      pending.delete(request);
      clearTimeout(saving);
      if (target.key() === key && target.activity() === 'Saving file…') target.setActivity('');
      button.disabled = false;
    }
  });
}
