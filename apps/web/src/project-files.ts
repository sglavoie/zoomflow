import standardLibrary from '../../../stdlib/zoomflow.d2?raw';
import { rememberDiskVersion } from './disk-version';
import { flowFilename } from './flow-model';

export type ProjectSource = { path: string; source: string };

/** The editor keeps `\n` line breaks; a file read with CRLF or CR breaks would otherwise differ from its own baseline
 * as soon as the editor's text is read back, showing unsaved changes that were never made. */
export const readSourceText = async (file: Blob) => (await file.text()).replace(/\r\n?/g, '\n');

/** Paths in D2's virtual filesystem always use forward slashes and stay in the chosen folder. */
export function validProjectPath(path: string): boolean {
  const parts = path.split('/');
  return parts.length > 0 && parts.every((part, index) => part && part !== '.' && part !== '..' &&
    (index === parts.length - 1 || !part.startsWith('.')) && !['node_modules', 'dist', 'coverage'].includes(part)) &&
    path.toLowerCase().endsWith('.d2') && !path.includes('\\') && !path.includes('\0') && !/^[A-Za-z]:/.test(path);
}

export function projectFileSystem(inputPath: string, sources: Record<string, string>, source: string) {
  const fs: Record<string, string> = Object.create(null);
  for (const [path, text] of Object.entries(sources)) fs[path] = text;
  fs[inputPath] = source;
  const folders = new Set<string>(['']);
  for (const path of Object.keys(fs)) {
    const parts = path.split('/').slice(0, -1);
    for (let count = 1; count <= parts.length; count++) folders.add(parts.slice(0, count).join('/'));
  }
  for (const folder of folders) {
    const library = folder ? `${folder}/zoomflow.d2` : 'zoomflow.d2';
    if (!Object.hasOwn(fs, library)) fs[library] = standardLibrary;
  }
  return { fs, inputPath };
}

export async function readFolderInput(files: Iterable<File>): Promise<{ name: string; files: ProjectSource[] }> {
  const chosen = [...files].filter((file) => file.webkitRelativePath);
  if (!chosen.length) throw new Error('Choose a folder containing .d2 files.');
  const name = chosen[0].webkitRelativePath.split('/')[0];
  const sources: ProjectSource[] = [];
  for (const file of chosen) {
    const [root, ...parts] = file.webkitRelativePath.split('/');
    if (root !== name) throw new Error('Choose one folder at a time.');
    const path = parts.join('/');
    if (validProjectPath(path)) sources.push({ path, source: await readSourceText(file) });
  }
  if (!sources.length) throw new Error('The selected folder has no .d2 files.');
  sources.sort((a, b) => a.path.localeCompare(b.path));
  return { name, files: sources };
}

type IterableDirectory = FileSystemDirectoryHandle & { values(): AsyncIterable<FileSystemHandle> };

/** The `.d2` files of a chosen folder and their handles; a folder without any is an error unless `allowEmpty`. */
export async function readDirectoryHandle(root: FileSystemDirectoryHandle, allowEmpty = false) {
  const files: ProjectSource[] = [];
  const handles: Record<string, FileSystemFileHandle> = Object.create(null);
  async function visit(directory: FileSystemDirectoryHandle, prefix: string) {
    for await (const entry of (directory as IterableDirectory).values()) {
      const path = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.kind === 'directory') {
        if (!entry.name.startsWith('.') && !['node_modules', 'dist', 'coverage'].includes(entry.name))
          await visit(entry as FileSystemDirectoryHandle, path);
      } else if (validProjectPath(path)) {
        const handle = entry as FileSystemFileHandle;
        handles[path] = handle;
        const file = await handle.getFile();
        rememberDiskVersion(handle, file);
        files.push({ path, source: await readSourceText(file) });
      }
    }
  }
  await visit(root, '');
  if (!files.length && !allowEmpty) throw new Error('The selected folder has no .d2 files.');
  files.sort((a, b) => a.path.localeCompare(b.path));
  return { name: root.name, files, handles, directory: root };
}

/** The file link from the project file at `fromPath` to the one at `toPath`, in the `./` or `../` form D2 keeps. */
export function fileLink(fromPath: string, toPath: string): string {
  const from = fromPath.split('/').slice(0, -1);
  const to = toPath.split('/');
  let common = 0;
  while (common < from.length && common < to.length - 1 && from[common] === to[common]) common++;
  const up = from.length - common;
  return `${up ? '../'.repeat(up) : './'}${to.slice(common).join('/')}`;
}

/** A new project path beside `fromPath`, named after `label`, that no path in `taken` has in any case.
 * Names leave out what links and file systems read specially, such as `#`, `?` and `%`, and never take the
 * folder's `zoomflow.d2`, which would replace the standard library for every file there that imports it. */
export function newProjectPath(fromPath: string, label: string, taken: Iterable<string>): string {
  const folder = fromPath.split('/').slice(0, -1).map(part => `${part}/`).join('');
  const used = new Set([...taken, `${folder}zoomflow.d2`].map(path => path.toLowerCase()));
  const base = flowFilename(label.replace(/[#%]/g, '-').replace(/\s+/g, ' '), '').slice(0, -3).replace(/^[. ]+/, '') || 'Diagram';
  let path = `${folder}${base}.d2`;
  for (let n = 2; used.has(path.toLowerCase()); n++) path = `${folder}${base} ${n}.d2`;
  return path;
}

/** Unwrap every recovery layer: concurrent edits to a recovered copy can themselves need recovery. */
function originalKey(key: string): string {
  let recovered: RegExpExecArray | null;
  while ((recovered = /^file:recovered:([^:]*):/.exec(key))) {
    try { key = decodeURIComponent(recovered[1]!); }
    catch { return ''; }
  }
  return key;
}

/** The project of a `project:<id>:<path>` or `atlas:<id>` key, also inside recovered copies' keys. */
export function projectIdOf(key: string) {
  return /^(?:project|atlas):([^:]*)/.exec(originalKey(key))?.[1];
}

/** The project path of a `project:<id>:<path>` key, also inside recovered copies' keys. */
export function projectPathOf(key: string) {
  const project = originalKey(key);
  return project.startsWith('project:') ? project.split(':').slice(2).join(':') : undefined;
}
