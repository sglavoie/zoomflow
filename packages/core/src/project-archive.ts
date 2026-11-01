import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';

/** Editable sources and opaque, versioned viewer metadata. Core does not interpret view settings. */
export type ProjectArchive = {
  name: string;
  entry: string;
  files: { path: string; source: string; view?: string }[];
};

export const projectArchiveLimit = 64 * 1024 * 1024;
const maxFiles = 10_000;
const manifestPath = 'zoomflow.json';

/** Paths in D2's virtual filesystem always use forward slashes and stay in the chosen folder. */
export function validProjectPath(path: string): boolean {
  const parts = path.split('/');
  return parts.length > 0 && parts.every((part, index) => part && part !== '.' && part !== '..' &&
    (index === parts.length - 1 || !part.startsWith('.')) && !['node_modules', 'dist', 'coverage'].includes(part)) &&
    path.toLowerCase().endsWith('.d2') && !path.includes('\\') && !path.includes('\0') && !/^[A-Za-z]:/.test(path);
}

function validate(project: ProjectArchive) {
  if (typeof project.name !== 'string' || !project.name.trim() || /[/\\]/.test(project.name))
    throw new Error('The project archive needs a name without folder separators.');
  if (!Array.isArray(project.files) || !project.files.length || project.files.length > maxFiles)
    throw new Error(`The project archive must contain between 1 and ${maxFiles} D2 files.`);
  const paths = new Set<string>();
  for (const file of project.files) {
    if (!file || typeof file.path !== 'string' || !validProjectPath(file.path) || paths.has(file.path))
      throw new Error('The project archive contains an invalid or duplicate source path.');
    if (typeof file.source !== 'string') throw new Error(`Missing D2 source: ${file.path}`);
    paths.add(file.path);
  }
  if (typeof project.entry !== 'string' || !paths.has(project.entry))
    throw new Error('The project archive entry file is missing.');
}

/** A normal ZIP: zoomflow.json describes sources/<project path>. Source errors never block a backup. */
export function exportProjectArchive(project: ProjectArchive): Uint8Array<ArrayBuffer> {
  validate(project);
  const files: Record<string, Uint8Array> = Object.create(null);
  const manifest = { format: 'zoomflow-project', version: 1, name: project.name, entry: project.entry,
    files: project.files.map(({ path, view }) => ({ path, view })) };
  files[manifestPath] = strToU8(JSON.stringify(manifest, null, 2));
  let size = files[manifestPath].length;
  for (const file of project.files) {
    const bytes = strToU8(file.source);
    size += bytes.length;
    if (size > projectArchiveLimit) throw new Error('Project archives support up to 64 MiB of uncompressed content.');
    files[`sources/${file.path}`] = bytes;
  }
  const archive = new Uint8Array(zipSync(files));
  if (archive.length > projectArchiveLimit) throw new Error('Project archives support downloads up to 64 MiB.');
  return archive;
}

/** Validate the complete archive before the host changes any drafts. Unknown view versions are the viewer's concern. */
export function readProjectArchive(bytes: Uint8Array): ProjectArchive {
  if (bytes.length > projectArchiveLimit) throw new Error('Project archives support downloads up to 64 MiB.');
  let size = 0;
  const seen = new Set<string>();
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(bytes, { filter(file) {
      if (seen.has(file.name)) throw new Error('Duplicate archive entry.');
      seen.add(file.name);
      if (seen.size > maxFiles * 2 + 1) throw new Error('Too many archive entries.');
      if (file.name !== manifestPath && !file.name.startsWith('sources/')) return false;
      if (file.name.endsWith('/')) return false;
      if (file.name !== manifestPath && !validProjectPath(file.name.slice('sources/'.length)))
        throw new Error('Invalid archive source path.');
      size += file.originalSize;
      if (size > projectArchiveLimit) throw new Error('Uncompressed content exceeds 64 MiB.');
      return true;
    } });
  } catch (error) {
    throw new Error(`Could not read project ZIP: ${error instanceof Error ? error.message : 'invalid ZIP data'}`);
  }
  if (!Object.hasOwn(files, manifestPath)) throw new Error('This ZIP is not a Zoomflow project: zoomflow.json is missing.');
  let manifest: { format?: unknown; version?: unknown; name?: unknown; entry?: unknown; files?: unknown };
  try { manifest = JSON.parse(strFromU8(files[manifestPath])); }
  catch { throw new Error('The project manifest is not valid JSON.'); }
  if (manifest?.format !== 'zoomflow-project') throw new Error('This ZIP is not a Zoomflow project.');
  if (manifest.version !== 1) throw new Error('This project archive version is not supported.');
  if (typeof manifest.name !== 'string' || typeof manifest.entry !== 'string') throw new Error('Invalid project name or entry file.');
  if (!Array.isArray(manifest.files) || manifest.files.length > maxFiles) throw new Error('Invalid project file list.');
  const project: ProjectArchive = { name: manifest.name, entry: manifest.entry, files: manifest.files.map((file: unknown) => {
    const item = file as { path?: unknown; view?: unknown } | null;
    if (!item || typeof item.path !== 'string' || !validProjectPath(item.path)) throw new Error('Invalid project source path.');
    const path = `sources/${item.path}`;
    if (!Object.hasOwn(files, path)) throw new Error(`Missing D2 source: ${item.path}`);
    return { path: item.path, source: strFromU8(files[path]).replace(/\r\n?/g, '\n'),
      view: typeof item.view === 'string' ? item.view : undefined };
  }) };
  validate(project);
  return project;
}
