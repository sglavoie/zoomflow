import { expect, it } from 'vitest';
import { changedOnDisk, refreshDiskVersion, rememberDiskVersion } from '../src/disk-version';

/** A file handle whose modification time the test controls. */
function handle(modified: number) {
  const disk = { modified, readable: true };
  const file = { name: 'doc.d2', getFile: async () => {
    if (!disk.readable) throw new DOMException('Gone', 'NotFoundError');
    return new File(['a: A'], 'doc.d2', { lastModified: disk.modified });
  } } as unknown as FileSystemFileHandle;
  return { file, disk };
}

it('reports external changes since a file was opened or last saved', async () => {
  const { file, disk } = handle(10);
  rememberDiskVersion(file, await file.getFile());
  await expect(changedOnDisk(file)).resolves.toBe(false);
  disk.modified = 11;
  await expect(changedOnDisk(file)).resolves.toBe(true);
  // Saving records the file's new modification time.
  await refreshDiskVersion(file);
  await expect(changedOnDisk(file)).resolves.toBe(false);
});

it('treats unknown and missing handles as unchanged but asks about unreadable files', async () => {
  const { file, disk } = handle(5);
  await expect(changedOnDisk(file)).resolves.toBe(false);
  rememberDiskVersion(file, await file.getFile());
  disk.readable = false;
  // A missing file has nothing to overwrite; writing to it reports the move instead.
  await expect(changedOnDisk(file)).resolves.toBe(false);
  // A failed refresh keeps the last known version rather than forgetting it.
  await refreshDiskVersion(file);
  disk.readable = true;
  disk.modified = 6;
  await expect(changedOnDisk(file)).resolves.toBe(true);
  const denied = { name: 'doc.d2', getFile: async () => { throw new DOMException('Denied', 'NotAllowedError'); } } as unknown as FileSystemFileHandle;
  rememberDiskVersion(denied, { lastModified: 5 });
  await expect(changedOnDisk(denied)).resolves.toBe(true);
});
