import type { DocumentPane, PaneId } from './document-pane';
import type { setupExamplePicker } from './example-picker';
import { readDirectoryHandle, readFolderInput, readSourceText } from './project-files';
import { rememberDiskVersion } from './disk-version';
import { createProjectFile, type DirectoryHandles, type FileHandles } from './file-handles';
import { plainLook } from './flow-model';
import { mindMapSource } from './mind-map-model';
import { describeError } from './text';

type PickerWindow = Window & {
  showOpenFilePicker?: (options?: object) => Promise<FileSystemFileHandle[]>;
  showDirectoryPicker?: (options?: { mode?: 'read' | 'readwrite' }) => Promise<FileSystemDirectoryHandle>;
};

export type FileOpenHost = {
  picker: () => ReturnType<typeof setupExamplePicker>;
  activePane: () => DocumentPane;
  fileHandles: FileHandles;
  directoryHandles: DirectoryHandles;
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

/** The home board a new atlas starts from: a mind map rooted at its folder's name, whose topics are added
 * on the board and each linked to a file it opens. */
export function atlasHome(name: string) {
  return mindMapSource({ direction: 'right', split: 0, look: plainLook(), root: { label: name, children: [] } });
}

/** Open .d2, Open folder, New atlas and dropped files, which open in the active pane. */
export function setupFileOpen({ picker, activePane, fileHandles, directoryHandles, paneRoots, setActive }: FileOpenHost) {
  const pickerWindow = window as PickerWindow;
  const fileStatus = document.querySelector<HTMLElement>('#file-status')!;
  function setFileError(message: string, pane = activePane()) {
    fileStatus.textContent = message;
    fileStatus.hidden = !message;
    if (message) pane.setActivity(message, 'error');
  }
  /** Resolves whether the file opened. */
  async function openFile(file: File, handle?: FileSystemFileHandle, pane = activePane()) {
    try {
      if (!/\.d2$/i.test(file.name)) throw new Error('Choose a .d2 file.');
      const source = await readSourceText(file);
      setFileError('', pane);
      // A file a draft came from before a reload opens that draft again.
      await fileHandles.ready();
      const key = picker().rememberFile(file.name, source, source, await sameEntries(fileHandles, () => handle), pane.id);
      if (handle) { rememberDiskVersion(handle, file); fileHandles.set(key, handle); }
      picker().refresh();
      await pane.replaceDocument(source, file.name, key);
      return true;
    }
    catch (error) { setFileError(`Could not open file: ${describeError(error)}`, pane); return false; }
  }
  const fileInput = document.querySelector<HTMLInputElement>('#file')!;
  fileInput.addEventListener('click', async (event) => {
    if (!pickerWindow.showOpenFilePicker) return;
    event.preventDefault();
    const pane = activePane();
    try {
      const [handle] = await pickerWindow.showOpenFilePicker({ types: [{ description: 'D2 source', accept: { 'text/plain': ['.d2'] } }] });
      if (handle) await openFile(await handle.getFile(), handle, pane);
    } catch (error) {
      if (!(error instanceof DOMException && error.name === 'AbortError')) setFileError(`Could not open file: ${describeError(error)}`, pane);
    }
  });
  fileInput.addEventListener('change', () => {
    const file = fileInput.files?.[0];
    fileInput.value = '';
    if (file) void openFile(file);
  });
  async function openFolder(folder: { name: string; files: { path: string; source: string }[];
    handles?: Record<string, FileSystemFileHandle>; directory?: FileSystemDirectoryHandle; saved?: boolean }, pane = activePane()) {
    setFileError('', pane);
    await fileHandles.ready();
    const selection = picker().rememberFolder(folder.name, folder.files,
      await sameEntries(fileHandles, (key) => key.startsWith('project:') ? folder.handles?.[key.split(':').slice(2).join(':')] : undefined),
      folder.saved, pane.id);
    for (const [path, handle] of Object.entries(folder.handles ?? {})) fileHandles.set(selection.keys[path], handle);
    // New linked files are created in the folder; a folder chosen without a handle keeps new files as drafts.
    if (folder.directory) directoryHandles.set(selection.projectId, folder.directory);
    picker().refresh();
    await pane.replaceDocument(selection.source, selection.name, selection.key);
  }
  const folderInput = document.querySelector<HTMLInputElement>('#folder')!;
  async function chooseFolder() {
    if (!pickerWindow.showDirectoryPicker) { folderInput.click(); return; }
    const pane = activePane();
    try { await openFolder(await readDirectoryHandle(await pickerWindow.showDirectoryPicker()), pane); }
    catch (error) {
      if (!(error instanceof DOMException && error.name === 'AbortError')) setFileError(`Could not open folder: ${describeError(error)}`, pane);
    }
  }
  document.querySelector<HTMLButtonElement>('#open-folder')!.addEventListener('click', () => void chooseFolder());
  document.querySelector<HTMLButtonElement>('#open-folder-picker')!.addEventListener('click', () => void chooseFolder());
  /** New atlas: an `index.d2` home board in a folder the person picks, opened as a project to link files from.
   * A folder that already has diagrams opens unchanged; a browser that cannot write to folders keeps a draft project. */
  async function newAtlas() {
    const pane = activePane();
    if (!pickerWindow.showDirectoryPicker) {
      // Nothing is on disk, so the home board counts as unsaved until it is saved or exported.
      await openFolder({ name: 'atlas', files: [{ path: 'index.d2', source: atlasHome('atlas') }], saved: false }, pane);
      pane.setActivity('This browser cannot write to folders, so the atlas is a draft. Export → Download project .zip keeps its files together.');
      return;
    }
    try {
      const directory = await pickerWindow.showDirectoryPicker({ mode: 'readwrite' });
      const existing = await readDirectoryHandle(directory, true);
      if (existing.files.length) {
        await openFolder(existing, pane);
        pane.setActivity(`${directory.name} already has diagrams, so it opened as a project.`);
        return;
      }
      if (await createProjectFile(directory, 'index.d2', atlasHome(directory.name)) === 'refused')
        throw new Error('Zoomflow needs permission to write to the folder.');
      await openFolder(await readDirectoryHandle(directory), pane);
      pane.setActivity('Created index.d2. Add a subtopic for each area, then choose New linked diagram… on it to add the file it opens.');
    } catch (error) {
      if (!(error instanceof DOMException && error.name === 'AbortError')) setFileError(`Could not create the atlas: ${describeError(error)}`, pane);
    }
  }
  document.querySelector<HTMLButtonElement>('#new-atlas-picker')!.addEventListener('click', () => void newAtlas());
  folderInput.addEventListener('change', async () => {
    const files = folderInput.files;
    const pane = activePane();
    try { if (files?.length) await openFolder(await readFolderInput(files), pane); }
    catch (error) { setFileError(`Could not open folder: ${describeError(error)}`, pane); }
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
  // Capture the drop before the editor sees it, or the editor also inserts the file's text where it lands.
  document.addEventListener('drop', (event) => {
    if (!event.dataTransfer?.files.length) return;
    event.preventDefault();
    event.stopPropagation();
    clearTimeout(dropHint);
    document.body.classList.remove('file-drop-active');
    // Dropping onto a pane opens the file there.
    const paneId = (['a', 'b'] as const).find((id) => event.target instanceof Node && paneRoots[id].contains(event.target));
    if (paneId) setActive(paneId);
    const pane = activePane();
    const [file, ...others] = event.dataTransfer.files;
    void openFile(file, undefined, pane).then((opened) => {
      // Each pane shows one document, so a drop opens only its first file.
      if (opened && others.length) pane.setActivity(`Opened ${file.name}; drop one file at a time.`);
    });
  }, { capture: true });
  return { setFileError };
}
