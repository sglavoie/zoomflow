import standardLibrary from '../../../stdlib/zoomflow.d2?raw';

export type ProjectSource = { path: string; source: string };

/** Paths in D2's virtual filesystem always use forward slashes and stay in the chosen folder. */
export function validProjectPath(path: string): boolean {
  const parts = path.split('/');
  return parts.length > 0 && parts.every((part, index) => part && part !== '.' && part !== '..' &&
    (index === parts.length - 1 || !part.startsWith('.')) && !['node_modules', 'dist', 'coverage'].includes(part)) &&
    path.endsWith('.d2') && !path.includes('\\') && !path.includes('\0') && !/^[A-Za-z]:/.test(path);
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

export async function readFolderInput(files: FileList): Promise<{ name: string; files: ProjectSource[] }> {
  const chosen = [...files].filter((file) => file.webkitRelativePath);
  if (!chosen.length) throw new Error('Choose a folder containing .d2 files.');
  const name = chosen[0].webkitRelativePath.split('/')[0];
  const sources: ProjectSource[] = [];
  for (const file of chosen) {
    const [root, ...parts] = file.webkitRelativePath.split('/');
    if (root !== name) throw new Error('Choose one folder at a time.');
    const path = parts.join('/');
    if (validProjectPath(path)) sources.push({ path, source: await file.text() });
  }
  if (!sources.length) throw new Error('The selected folder has no .d2 files.');
  sources.sort((a, b) => a.path.localeCompare(b.path));
  return { name, files: sources };
}

type IterableDirectory = FileSystemDirectoryHandle & { values(): AsyncIterable<FileSystemHandle> };

export async function readDirectoryHandle(root: FileSystemDirectoryHandle) {
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
        files.push({ path, source: await (await handle.getFile()).text() });
      }
    }
  }
  await visit(root, '');
  if (!files.length) throw new Error('The selected folder has no .d2 files.');
  files.sort((a, b) => a.path.localeCompare(b.path));
  return { name: root.name, files, handles };
}
