import type { setupExamplePicker } from './example-picker';
import { changedOnDisk, refreshDiskVersion } from './disk-version';
import { hasWritePermission, queryWritePermission, writePermission, type FileHandles } from './file-handles';
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

export type SaveFileResult = { status: 'saved' | 'skipped' | 'failed' | 'downloaded'; message: string };

/** Shared by single-file and project saves, including their file and document locks.
 * Project saves only write existing destinations; missing handles remain unsaved for an explicit save or ZIP. */
export async function saveFile(target: SaveFileTarget, options: { existingOnly?: boolean; requestPermission?: boolean } = {}): Promise<SaveFileResult> {
  /** Save notices cleared once a save succeeds. */
  const notices = new Set([moved, inProgress, fileInProgress]);
  const key = target.key();
  if (!key) return { status: 'skipped', message: 'The draft is no longer available.' };
  const pending = pendingSaves.get(target.fileHandles) ?? new Set<PendingSave>();
  pendingSaves.set(target.fileHandles, pending);
  if ([...pending].some(save => save.key === key)) { target.setActivity(inProgress); return { status: 'skipped', message: inProgress }; }
  const request: PendingSave = { key };
  pending.add(request);
  const source = target.source();
  const name = target.name();
  const version = target.picker().diskSaveVersion(key);
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
    let unavailable = 'No file destination. Use Save .d2 for this file or download the project ZIP.';
    // A handle restored after a reload needs permission again; without it, ask where to save.
    if (handle) {
      const permission = options.requestPermission === false
        ? await queryWritePermission(handle)
        : refused.get(key) === handle
        ? (await hasWritePermission(handle) ? 'granted' : 'denied')
        : await writePermission(handle);
      if (permission !== 'granted') {
        if (permission === 'denied') refused.set(key, handle);
        notify(permission === 'denied' ? `Zoomflow may not write ${handle.name}; choose where to save.`
          : `Zoomflow needs permission to write ${handle.name}; choose where to save.`);
        unavailable = `Write permission ${permission === 'denied' ? 'denied' : 'needed'}. Use Save .d2 for this file or download the project ZIP.`;
        handle = undefined;
      }
    }
    if (handle && !await reserveFile(handle)) return { status: 'skipped', message: fileInProgress };
    if (handle && await changedOnDisk(handle)) {
      const focused = document.activeElement;
      const overwrite = await target.picker().confirm('File changed on disk — overwrite?',
        `${handle.name} changed outside Zoomflow since it was opened or last saved. Saving replaces those changes with the source shown here.`,
        'Overwrite file', () => { if (focused instanceof HTMLElement && focused.isConnected) focused.focus({ preventScroll: true }); });
      if (!overwrite) {
        if (target.key() === key) target.setActivity('Save canceled. The file on disk is unchanged.');
        return { status: 'skipped', message: 'Overwrite cancelled. The file on disk is unchanged.' };
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
        unavailable = moved;
      }
    }
    if (!handle && options.existingOnly) return { status: 'skipped', message: unavailable };
    if (!handle && pickerWindow.showSaveFilePicker) {
      try {
        handle = await pickerWindow.showSaveFilePicker({ suggestedName: name,
          types: [{ description: 'D2 source', accept: { 'text/plain': ['.d2'] } }] });
      } catch (error) {
        // Answering the permission prompt can use up the click that opens the save dialog.
        if (!(error instanceof DOMException && error.name === 'SecurityError')) throw error;
        notify('Click Save again to choose where to save.');
        return { status: 'skipped', message: 'Click Save again to choose where to save.' };
      }
      if (!await reserveFile(handle)) return { status: 'skipped', message: fileInProgress };
    }
    if (!handle) {
      const filename = downloadSource(source, name);
      if (target.key() === key) {
        if (target.source() === source) target.downloaded();
        target.setActivity(`Source download started: ${filename}`);
      }
      return { status: 'downloaded', message: `Source download started: ${filename}` };
    }
    saving = setTimeout(() => { if (target.key() === key) target.setActivity('Saving file…'); }, 700);
    writable ??= await handle.createWritable();
    try { await writable.write(source); await writable.close(); }
    // Aborting an already failed stream can reject too; report the write error instead.
    catch (error) { await writable.abort().catch(() => {}); throw error; }
    await refreshDiskVersion(handle);
    const saved = target.picker().markDiskSaved(key, source, handle.name, version);
    if (!saved) return { status: 'skipped', message: 'The draft was removed or renamed during saving; its saved state was not changed.' };
    target.fileHandles.set(saved.key, handle);
    refused.delete(key);
    target.adopt(key, saved);
    if (target.key() === key && notices.has(target.activity() ?? '')) target.setActivity('');
    return { status: 'saved', message: 'Saved to file.' };
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') return { status: 'skipped', message: 'Save cancelled.' };
    // Name the file when another document is open by now, so the failure is not mistaken for this one's.
    target.setActivity(target.key() === key ? `Could not save file: ${describeError(error)}`
      : `Could not save ${name}: ${describeError(error)}`, 'error');
    return { status: 'failed', message: describeError(error) };
  } finally {
    pending.delete(request);
    clearTimeout(saving);
    if (target.key() === key && target.activity() === 'Saving file…') target.setActivity('');
  }
}

/** Save writes the source back to its file, asks for one, or falls back to a download. */
export function setupSaveFile(button: HTMLButtonElement, target: SaveFileTarget) {
  button.addEventListener('click', async () => {
    button.disabled = true;
    try { await saveFile(target); }
    finally { button.disabled = false; }
  });
}
