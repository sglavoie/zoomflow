import type { DocumentPane, PaneId } from './document-pane';
import type { setupExamplePicker } from './example-picker';
import { readDirectoryHandle, readFolderInput } from './project-files';
import { rememberDiskVersion } from './disk-version';
import { describeError } from './text';

type PickerWindow = Window & {
  showOpenFilePicker?: (options?: object) => Promise<FileSystemFileHandle[]>;
  showDirectoryPicker?: () => Promise<FileSystemDirectoryHandle>;
};

export type FileOpenHost = {
  picker: () => ReturnType<typeof setupExamplePicker>;
  activePane: () => DocumentPane;
  fileHandles: Map<string, FileSystemFileHandle>;
  paneRoots: Record<PaneId, HTMLElement>;
  setActive: (pane: PaneId) => void;
};

/** Whether a draft's stored file handle is the file being opened; undefined for drafts without a handle.
 * A file opened without a handle (a drop or the input fallback) may be another file of the same name. */
export async function sameEntries(fileHandles: Map<string, FileSystemFileHandle>, opened: (key: string) => FileSystemFileHandle | undefined) {
  const known = new Map<string, boolean>();
  for (const [key, existing] of fileHandles) {
    const handle = opened(key);
    known.set(key, handle ? await existing.isSameEntry(handle).catch(() => false) : false);
  }
  return (key: string) => known.get(key);
}

/** Open .d2, Open folder and dropped files, which open in the active pane. */
export function setupFileOpen({ picker, activePane, fileHandles, paneRoots, setActive }: FileOpenHost) {
  const pickerWindow = window as PickerWindow;
  const fileStatus = document.querySelector<HTMLElement>('#file-status')!;
  function setFileError(message: string) {
    fileStatus.textContent = message;
    fileStatus.hidden = !message;
    if (message) activePane().setActivity(message, 'error');
  }
  /** Resolves whether the file opened. */
  async function openFile(file: File, handle?: FileSystemFileHandle) {
    try {
      if (!/\.d2$/i.test(file.name)) throw new Error('Choose a .d2 file.');
      const source = await file.text();
      setFileError('');
      const key = picker().rememberFile(file.name, source, source, await sameEntries(fileHandles, () => handle));
      if (handle) { fileHandles.set(key, handle); rememberDiskVersion(handle, file); }
      picker().refresh();
      await activePane().replaceDocument(source, file.name, key);
      return true;
    }
    catch (error) { setFileError(`Could not open file: ${describeError(error)}`); return false; }
  }
  const fileInput = document.querySelector<HTMLInputElement>('#file')!;
  fileInput.addEventListener('click', async (event) => {
    if (!pickerWindow.showOpenFilePicker) return;
    event.preventDefault();
    try {
      const [handle] = await pickerWindow.showOpenFilePicker({ types: [{ description: 'D2 source', accept: { 'text/plain': ['.d2'] } }] });
      if (handle) await openFile(await handle.getFile(), handle);
    } catch (error) {
      if (!(error instanceof DOMException && error.name === 'AbortError')) setFileError(`Could not open file: ${describeError(error)}`);
    }
  });
  fileInput.addEventListener('change', () => {
    const file = fileInput.files?.[0];
    fileInput.value = '';
    if (file) void openFile(file);
  });
  async function openFolder(folder: { name: string; files: { path: string; source: string }[];
    handles?: Record<string, FileSystemFileHandle> }) {
    setFileError('');
    const selection = picker().rememberFolder(folder.name, folder.files,
      await sameEntries(fileHandles, (key) => key.startsWith('project:') ? folder.handles?.[key.split(':').slice(2).join(':')] : undefined));
    for (const [path, handle] of Object.entries(folder.handles ?? {})) fileHandles.set(selection.keys[path], handle);
    picker().refresh();
    await activePane().replaceDocument(selection.source, selection.name, selection.key);
  }
  const folderInput = document.querySelector<HTMLInputElement>('#folder')!;
  async function chooseFolder() {
    if (!pickerWindow.showDirectoryPicker) { folderInput.click(); return; }
    try { await openFolder(await readDirectoryHandle(await pickerWindow.showDirectoryPicker())); }
    catch (error) {
      if (!(error instanceof DOMException && error.name === 'AbortError')) setFileError(`Could not open folder: ${describeError(error)}`);
    }
  }
  document.querySelector<HTMLButtonElement>('#open-folder')!.addEventListener('click', () => void chooseFolder());
  document.querySelector<HTMLButtonElement>('#open-folder-picker')!.addEventListener('click', () => void chooseFolder());
  folderInput.addEventListener('change', async () => {
    const files = folderInput.files;
    try { if (files?.length) await openFolder(await readFolderInput(files)); }
    catch (error) { setFileError(`Could not open folder: ${describeError(error)}`); }
    finally { folderInput.value = ''; }
  });
  let dropHint: ReturnType<typeof setTimeout> | undefined;
  document.addEventListener('dragover', (event) => {
    if (!event.dataTransfer?.types.includes('Files')) return;
    event.preventDefault();
    document.body.classList.add('file-drop-active');
    clearTimeout(dropHint);
    dropHint = setTimeout(() => document.body.classList.remove('file-drop-active'), 160);
  });
  document.addEventListener('drop', (event) => {
    if (!event.dataTransfer?.files.length) return;
    event.preventDefault();
    clearTimeout(dropHint);
    document.body.classList.remove('file-drop-active');
    // Dropping onto a pane opens the file there.
    const pane = (['a', 'b'] as const).find((id) => event.target instanceof Node && paneRoots[id].contains(event.target));
    if (pane) setActive(pane);
    const [file, ...others] = event.dataTransfer.files;
    void openFile(file).then((opened) => {
      // Each pane shows one document, so a drop opens only its first file.
      if (opened && others.length) activePane().setActivity(`Opened ${file.name}; drop one file at a time.`);
    });
  });
  return { setFileError };
}
