// @vitest-environment happy-dom
import { expect, it, vi } from 'vitest';
import { createProjectSave, type ProjectSaveHost, type ProjectSaveSnapshot, type ProjectSaveState } from '../src/project-save';
import { saveFile, type SaveFileTarget } from '../src/save-file';

function project() {
  const snapshot: ProjectSaveSnapshot = { id: 'notes', name: 'Notes', files: ['a.d2', 'nested/b.d2'].map(path => ({
    key: path, path, name: path.split('/').at(-1)!, source: `${path}: Changed`,
  })) };
  const writes: string[] = [];
  const handles = new Map(snapshot.files.map(file => [file.key, {
    name: file.name, isSameEntry: async (other: FileSystemHandle) => other === handles.get(file.key),
    getFile: async () => new File(['original'], file.name, { lastModified: 1 }),
    createWritable: async () => ({
      write: async () => { writes.push(file.path); }, close: async () => {}, abort: async () => {},
    }),
  } as unknown as FileSystemFileHandle]));
  const picker = {
    hasDraft: (_key: string) => true, hasProject: () => true, diskSaveVersion: () => 0,
    markDiskSaved: vi.fn((key: string, _source: string, name: string) => ({ key, name })),
  };
  const host: ProjectSaveHost = {
    fileHandles: Object.assign(handles, { ready: async () => {} }) as ProjectSaveHost['fileHandles'],
    directoryHandles: Object.assign(new Map(), { restore: async () => {} }) as unknown as ProjectSaveHost['directoryHandles'],
    picker: () => picker as unknown as ReturnType<ProjectSaveHost['picker']>, adopt: vi.fn(),
  };
  let state: ProjectSaveState | undefined;
  const saver = createProjectSave(host, next => { state = next; });
  return { snapshot, host, picker, writes, saver, state: () => state! };
}

it('shares single-file locks, skips the busy file, and saves the other file', async () => {
  const p = project();
  let release!: () => void;
  Object.assign(p.host.fileHandles.get('a.d2')!, { createWritable: async () => ({
    write: () => new Promise<void>(resolve => { release = resolve; }), close: async () => {}, abort: async () => {},
  }) });
  const target: SaveFileTarget = {
    ...p.host, key: () => 'a.d2', name: () => 'a.d2', source: () => 'a: Newer single save',
    downloaded: () => {}, setActivity: () => {}, activity: () => '',
  };
  const single = saveFile(target);
  await vi.waitFor(() => expect(release).toBeTypeOf('function'));
  try {
    await p.saver.start(p.snapshot);
    expect(p.state().results.map(result => result.status)).toEqual(['skipped', 'saved']);
    expect(p.state().results[0].message).toContain('still in progress');
    expect(p.writes).toEqual(['nested/b.d2']);
  } finally { release(); await single; }
});

it('ignores a second batch while writing and skips a draft removed before its turn', async () => {
  const p = project();
  let release!: () => void;
  Object.assign(p.host.fileHandles.get('a.d2')!, { createWritable: async () => ({
    write: () => new Promise<void>(resolve => { release = resolve; }), close: async () => {}, abort: async () => {},
  }) });
  const saving = p.saver.start(p.snapshot);
  await vi.waitFor(() => expect(release).toBeTypeOf('function'));
  p.picker.hasDraft = key => key !== 'nested/b.d2';
  await p.saver.start({ ...p.snapshot, id: 'other' });
  release();
  await saving;
  expect(p.state().project.id).toBe('notes');
  expect(p.state().results.map(result => result.status)).toEqual(['saved', 'skipped']);
  expect(p.state().results[1].message).toContain('no longer available');
  expect(p.picker.markDiskSaved).toHaveBeenCalledTimes(1);
});

it('a write failure releases its file lock for retry and does not update its saved baseline', async () => {
  const p = project();
  const handle = p.host.fileHandles.get('a.d2')!;
  const original = handle.createWritable;
  Object.assign(handle, { createWritable: async () => ({ write: async () => { throw new Error('Disk full'); }, abort: async () => {} }) });
  await p.saver.start(p.snapshot);
  expect(p.state().results.map(result => result.status)).toEqual(['failed', 'saved']);
  expect(p.picker.markDiskSaved.mock.calls.map(call => call[0])).toEqual(['nested/b.d2']);
  Object.assign(handle, { createWritable: original });
  await p.saver.start({ ...p.snapshot, files: [p.snapshot.files[0]] });
  expect(p.state().results[0].status).toBe('saved');
});
