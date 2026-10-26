/** The modification time of each file handle when Zoomflow last read or wrote it. */
const versions = new WeakMap<FileSystemFileHandle, number>();

/** `file` may be a stored modification time, for a handle restored after reload. */
export function rememberDiskVersion(handle: FileSystemFileHandle, file: { lastModified: number }) {
  versions.set(handle, file.lastModified);
}

export const diskVersion = (handle: FileSystemFileHandle) => versions.get(handle);

/** Record the file's current modification time, after opening or saving it.
 * An unreadable file keeps the previous time, so the next save still compares against it. */
export async function refreshDiskVersion(handle: FileSystemFileHandle) {
  try { rememberDiskVersion(handle, await handle.getFile()); }
  catch { /* Keep the last known version. */ }
}

/** Whether another program changed the file since Zoomflow last read or wrote it.
 * Unknown handles, such as a newly chosen destination, count as unchanged. A file that cannot be read
 * counts as changed, so Save asks first; a missing file has nothing to overwrite and is reported when writing. */
export async function changedOnDisk(handle: FileSystemFileHandle) {
  const known = versions.get(handle);
  if (known === undefined) return false;
  try { return (await handle.getFile()).lastModified !== known; }
  catch (error) { return !(error instanceof DOMException && error.name === 'NotFoundError'); }
}
