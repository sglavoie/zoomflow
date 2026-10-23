import { expect, it } from 'vitest';
import { sameEntries } from '../src/file-open';

const handle = (id: string) => ({ id, isSameEntry: async (other: { id?: string }) => other.id === id }) as unknown as FileSystemFileHandle;

it('matches drafts by file handle and never reuses a handled draft for a file without one', async () => {
  const handles = new Map([['file:a', handle('a')], ['file:b', handle('b')]]);
  const picked = await sameEntries(handles, () => handle('a'));
  expect([picked('file:a'), picked('file:b'), picked('file:none')]).toEqual([true, false, undefined]);
  // A dropped file has no handle: drafts holding one may point at another file of the same name.
  const dropped = await sameEntries(handles, () => undefined);
  expect([dropped('file:a'), dropped('file:none')]).toEqual([false, undefined]);
});
