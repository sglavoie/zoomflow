import type { D2 } from '@d2lang/d2';
import { lstat, readdir, readFile, realpath } from 'node:fs/promises';
import { basename, isAbsolute, join, relative, resolve, sep } from 'node:path';

export function within(root: string, path: string): boolean {
  const rel = relative(root, path);
  return !isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${sep}`);
}

/** Whether a project path names a regular file inside --root, by the real-path rules imports follow. */
export async function projectFile(root: string, realRoot: string, key: string): Promise<boolean> {
  const path = resolve(root, key);
  if (!within(root, path)) return false;
  try { return (await lstat(path)).isFile() && within(realRoot, await realpath(path)) && await exactCase(root, path); } catch { return false; }
}

/** Whether each folder and file name of a path inside `root` is spelled as on disk. Case-insensitive file systems
 * also open `Health.d2` as `health.d2`, which case-sensitive systems and the web app do not, so it counts as missing. */
export async function exactCase(root: string, path: string): Promise<boolean> {
  let folder = root;
  for (const part of relative(root, path).split(sep)) {
    // A folder that cannot be listed, only entered, cannot tell; its file is then taken as spelled.
    const names = await readdir(folder).catch(() => undefined);
    if (names && !names.includes(part)) return false;
    folder = join(folder, part);
  }
  return true;
}

// Matches both D2's raw JSON error text, with escaped quotes, and its decoded messages.
export const failedImport = /failed to import \\?"([^"\\]+)\\?": file does not exist/g;

/** Compile from a snapshot of the input and the D2 files it imports; never modify the user's files.
 * D2 names every missing import at once, so each retry loads one more level of nested imports.
 * Returns the snapshot for native export; failures carry why an import could not be loaded.
 */
export async function compileSources(d2: D2, root: string, realRoot: string, inputPath: string) {
  const files: Record<string, string> = Object.create(null);
  const problems = new Map<string, string>();
  const library = await readFile(new URL('../../../stdlib/zoomflow.d2', import.meta.url), 'utf8');
  async function load(key: string): Promise<boolean> {
    const path = resolve(root, key);
    if (!within(root, path)) { problems.set(key, `outside --root ${root}; pass --root to include it`); return false; }
    try {
      const entry = await lstat(path);
      if (!entry.isFile()) throw Object.assign(new Error(), { code: entry.isSymbolicLink() ? 'ELOOP' : 'EISDIR' });
      if (!within(realRoot, await realpath(path))) { problems.set(key, `outside --root ${root} through a symlinked directory`); return false; }
      // The input keeps the spelling it was given; imports must match the disk, as on case-sensitive systems.
      if (key !== inputPath && !(await exactCase(root, path))) { problems.set(key, 'letter case differs from the file on disk'); return false; }
      files[key] = await readFile(path, 'utf8');
    } catch (error) {
      const code = (error as { code?: string }).code ?? '';
      // D2 resolves imports relative to their importing file, so the stdlib sits beside every source.
      // Only a missing file falls back; a local zoomflow.d2 that cannot be used is reported, not silently replaced.
      if (basename(key) === 'zoomflow.d2' && code === 'ENOENT') files[key] = library;
      else if (code === 'ELOOP') problems.set(key, 'symlinks are not followed');
      else if (code === 'EISDIR') problems.set(key, 'not a regular file');
      else if (code === 'EACCES' || code === 'EPERM') problems.set(key, 'cannot read: permission denied');
      else if (code !== 'ENOENT') problems.set(key, `cannot read: ${(error as Error).message || code}`);
    }
    return Object.hasOwn(files, key);
  }
  // D2 would only report the input missing from its snapshot, so name why it could not be read.
  if (!(await load(inputPath)) && problems.has(inputPath)) throw Object.assign(new Error(`${inputPath}: ${problems.get(inputPath)}`), { problems });
  const tried = new Set([inputPath]);
  for (;;) {
    try {
      return { compiled: await d2.compile({ fs: files, inputPath, options: { layout: 'elk' } }), files };
    } catch (error) {
      // Go's JSON escapes `&`, `<` and `>` in the raw error text, so decode them to match names holding them.
      const message = String((error as Error).message).replace(/\\u([\da-f]{4})/gi, (_escape, hex: string) => String.fromCharCode(parseInt(hex, 16)));
      const wanted = [...message.matchAll(failedImport)].map((match) => match[1]).filter((key) => !tried.has(key));
      wanted.forEach((key) => tried.add(key));
      if (!(await Promise.all(wanted.map(load))).some(Boolean)) throw Object.assign(error as Error, { problems });
    }
  }
}
