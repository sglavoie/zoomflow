import type { setupExamplePicker } from './example-picker';
import { changedOnDisk, refreshDiskVersion } from './disk-version';
import { describeError } from './text';

type PickerWindow = Window & { showSaveFilePicker?: (options?: object) => Promise<FileSystemFileHandle> };
const pickerWindow = window as PickerWindow;

const moved = 'The file was moved or deleted; choose where to save.';

/** Whether this browser can ask where to save a new file. */
export const canChooseSaveFile = () => Boolean(pickerWindow.showSaveFilePicker);

export type SaveFileTarget = {
  fileHandles: Map<string, FileSystemFileHandle>;
  picker: () => ReturnType<typeof setupExamplePicker>;
  /** The document the pane shows now, if any. */
  key: () => string | undefined;
  name: () => string;
  source: () => string;
  /** The saved draft is still open: take on its key and name, which a saved example changes. */
  adopt: (saved: { key: string; name: string }) => void;
  setActivity: (message: string, kind?: 'info' | 'error') => void;
  activity: () => string | null;
};

/** Save writes the source back to its file, asks for one, or falls back to a download. */
export function setupSaveFile(button: HTMLButtonElement, target: SaveFileTarget) {
  button.addEventListener('click', async () => {
    if (!target.key()) return;
    button.disabled = true;
    const key = target.key()!;
    const source = target.source();
    const name = target.name();
    let saving: ReturnType<typeof setTimeout> | undefined;
    try {
      let handle = target.fileHandles.get(key);
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
          if (target.key() === key) target.setActivity(moved);
        }
      }
      if (!handle && pickerWindow.showSaveFilePicker) {
        handle = await pickerWindow.showSaveFilePicker({ suggestedName: name,
          types: [{ description: 'D2 source', accept: { 'text/plain': ['.d2'] } }] });
      }
      if (!handle) {
        document.querySelector<HTMLButtonElement>('#save-source')!.click();
        return;
      }
      saving = setTimeout(() => { if (target.key() === key) target.setActivity('Saving file…'); }, 700);
      writable ??= await handle.createWritable();
      try { await writable.write(source); await writable.close(); }
      catch (error) { await writable.abort(); throw error; }
      await refreshDiskVersion(handle);
      const saved = target.picker().markDiskSaved(key, source, handle.name);
      if (!saved) return; // The draft may have been removed while the file dialog was open.
      target.fileHandles.set(saved.key, handle);
      if (target.key() === key) target.adopt(saved);
      if (target.key() === key && target.activity() === moved) target.setActivity('');
    } catch (error) {
      if (target.key() === key && !(error instanceof DOMException && error.name === 'AbortError')) target.setActivity(`Could not save file: ${describeError(error)}`, 'error');
    } finally {
      clearTimeout(saving);
      if (target.key() === key && target.activity() === 'Saving file…') target.setActivity('');
      button.disabled = false;
    }
  });
}
