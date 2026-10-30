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
  const requests = new WeakMap<DocumentPane, symbol>();
  /** Capture intent before any picker or disk await. Focus changes are allowed; a newer open, a document
   * switch or closing the pane supersedes this request, including its errors and completion notices. */
  function beginOpen(pane = activePane()) {
    const token = Symbol();
    requests.set(pane, token);
    let opens = pane.documentOpens;
    const current = () => requests.get(pane) === token && pane.documentOpens === opens;
    return {
      pane, current,
      async show(source: string, name: string, key: string) {
        if (!current()) return false;
        const loading = pane.replaceDocument(source, name, key);
        opens = pane.documentOpens;
        await loading;
        return current();
      },
    };
  }
  type Opening = ReturnType<typeof beginOpen>;
  function setFileError(message: string, pane = activePane()) {
    fileStatus.textContent = message;
    fileStatus.hidden = !message;
    if (message) pane.setActivity(message, 'error');
  }
  /** Resolves whether the file opened. */
  async function openFile(file: File, handle: FileSystemFileHandle | undefined, request: Opening) {
    const { pane, current } = request;
    try {
      if (!/\.d2$/i.test(file.name)) throw new Error('Choose a .d2 file.');
      const source = await readSourceText(file);
      // A file a draft came from before a reload opens that draft again.
      await fileHandles.ready();
      const matches = await sameEntries(fileHandles, () => handle);
      if (!current()) return false;
      setFileError('', pane);
      const key = picker().rememberFile(file.name, source, source, matches, pane.id);
      if (handle) { rememberDiskVersion(handle, file); fileHandles.set(key, handle); }
      picker().refresh();
      return await request.show(source, file.name, key);
    }
    catch (error) { if (current()) setFileError(`Could not open file: ${describeError(error)}`, pane); return false; }
  }
  const fileInput = document.querySelector<HTMLInputElement>('#file')!;
  fileInput.addEventListener('click', async (event) => {
    if (!pickerWindow.showOpenFilePicker) return;
    event.preventDefault();
    const request = beginOpen();
    try {
      const [handle] = await pickerWindow.showOpenFilePicker({ types: [{ description: 'D2 source', accept: { 'text/plain': ['.d2'] } }] });
      if (handle && request.current()) await openFile(await handle.getFile(), handle, request);
    } catch (error) {
      if (request.current() && !(error instanceof DOMException && error.name === 'AbortError')) setFileError(`Could not open file: ${describeError(error)}`, request.pane);
    }
  });
  fileInput.addEventListener('change', () => {
    const file = fileInput.files?.[0];
    fileInput.value = '';
    if (file) void openFile(file, undefined, beginOpen());
  });
  async function openFolder(folder: { name: string; files: { path: string; source: string }[];
    handles?: Record<string, FileSystemFileHandle>; directory?: FileSystemDirectoryHandle; saved?: boolean }, request: Opening) {
    const { pane, current } = request;
    await fileHandles.ready();
    const matches = await sameEntries(fileHandles, (key) => key.startsWith('project:') ? folder.handles?.[key.split(':').slice(2).join(':')] : undefined);
    if (!current()) return false;
    setFileError('', pane);
    const selection = picker().rememberFolder(folder.name, folder.files,
      matches, folder.saved, pane.id);
    for (const [path, handle] of Object.entries(folder.handles ?? {})) fileHandles.set(selection.keys[path], handle);
    // New linked files are created in the folder; a folder chosen without a handle keeps new files as drafts.
    if (folder.directory) directoryHandles.set(selection.projectId, folder.directory);
    picker().refresh();
    return request.show(selection.source, selection.name, selection.key);
  }
  const folderInput = document.querySelector<HTMLInputElement>('#folder')!;
  async function chooseFolder() {
    if (!pickerWindow.showDirectoryPicker) { folderInput.click(); return; }
    const request = beginOpen();
    try { await openFolder(await readDirectoryHandle(await pickerWindow.showDirectoryPicker()), request); }
    catch (error) {
      if (request.current() && !(error instanceof DOMException && error.name === 'AbortError')) setFileError(`Could not open folder: ${describeError(error)}`, request.pane);
    }
  }
  document.querySelector<HTMLButtonElement>('#open-folder')!.addEventListener('click', () => void chooseFolder());
  document.querySelector<HTMLButtonElement>('#open-folder-picker')!.addEventListener('click', () => void chooseFolder());
  /** New atlas: an `index.d2` home board in a folder the person picks, opened as a project to link files from.
   * A folder that already has diagrams opens unchanged; a browser that cannot write to folders keeps a draft project. */
  async function newAtlas() {
    const request = beginOpen();
    const { pane, current } = request;
    if (!pickerWindow.showDirectoryPicker) {
      // Nothing is on disk, so the home board counts as unsaved until it is saved or exported.
      if (await openFolder({ name: 'atlas', files: [{ path: 'index.d2', source: atlasHome('atlas') }], saved: false }, request))
        pane.setActivity('This browser cannot write to folders, so the atlas is a draft. Export → Download project .zip keeps its files together.');
      return;
    }
    try {
      const directory = await pickerWindow.showDirectoryPicker({ mode: 'readwrite' });
      const existing = await readDirectoryHandle(directory, true);
      if (!current()) return;
      if (existing.files.length) {
        if (await openFolder(existing, request)) pane.setActivity(`${directory.name} already has diagrams, so it opened as a project.`);
        return;
      }
      if (await createProjectFile(directory, 'index.d2', atlasHome(directory.name)) === 'refused')
        throw new Error('Zoomflow needs permission to write to the folder.');
      if (await openFolder(await readDirectoryHandle(directory), request))
        pane.setActivity('Created index.d2. Add a subtopic for each area, then choose New linked diagram… on it to add the file it opens.');
    } catch (error) {
      if (current() && !(error instanceof DOMException && error.name === 'AbortError')) setFileError(`Could not create the atlas: ${describeError(error)}`, pane);
    }
  }
  document.querySelector<HTMLButtonElement>('#new-atlas-picker')!.addEventListener('click', () => void newAtlas());
  folderInput.addEventListener('change', async () => {
    // Snapshot before resetting, so a superseded folder can be selected again without an old read clearing a
    // newer selection. FileList belongs to the input; the File objects survive its reset.
    const files = [...folderInput.files ?? []];
    folderInput.value = '';
    if (!files.length) return;
    const request = beginOpen();
    try { await openFolder(await readFolderInput(files), request); }
    catch (error) { if (request.current()) setFileError(`Could not open folder: ${describeError(error)}`, request.pane); }
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
    void openFile(file, undefined, beginOpen(pane)).then((opened) => {
      // Each pane shows one document, so a drop opens only its first file.
      if (opened && others.length) pane.setActivity(`Opened ${file.name}; drop one file at a time.`);
    });
  }, { capture: true });
  return { setFileError };
}
