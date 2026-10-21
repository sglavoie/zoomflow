/** The modification time of each file handle when Zoomflow last read or wrote it. */
const versions = new WeakMap<FileSystemFileHandle, number>();

export function rememberDiskVersion(handle: FileSystemFileHandle, file: File) {
  versions.set(handle, file.lastModified);
}

/** Record the file's current modification time, after opening or saving it. */
export async function refreshDiskVersion(handle: FileSystemFileHandle) {
  try { rememberDiskVersion(handle, await handle.getFile()); }
  catch { versions.delete(handle); }
}

/** Whether another program changed the file since Zoomflow last read or wrote it.
 * Unknown handles, such as a newly chosen destination, and unreadable files count as unchanged. */
export async function changedOnDisk(handle: FileSystemFileHandle) {
  const known = versions.get(handle);
  if (known === undefined) return false;
  try { return (await handle.getFile()).lastModified !== known; }
  catch { return false; }
}
