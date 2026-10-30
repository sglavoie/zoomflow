import { D2 } from '@d2lang/d2';
import { afterAll, expect, it, vi } from 'vitest';
import { CompilerStartupError } from '../src/compiler';
import { createProjectCheck, projectCheckStamp, type ProjectCheckSnapshot, type ProjectCheckState } from '../src/project-check';

const d2 = new D2();
afterAll(() => d2.dispose());
const compile = (path: string, fs: Record<string, string>) => d2.compile({ inputPath: path, fs }, { layout: 'elk' });
const snapshot = (fs: Record<string, string>): ProjectCheckSnapshot => ({ id: 'project', fs, options: {} });
function observe() {
  let state!: ProjectCheckState;
  return { changed(next: ProjectCheckState) { state = next; }, get state() { return state; },
    async settled() { await vi.waitFor(() => expect(state.running).toBe(false), { timeout: 30_000 }); } };
}
function gate() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

it('checks fresh target boards regardless of file order, and finds all broken links after an unvisited target changes', async () => {
  const observed = observe();
  const check = createProjectCheck(compile, observed.changed);
  const fs = {
    'a.d2': 'a: {link: "./target.d2#/Before"}',
    'target.d2': 'layers.Before: {step}',
    'z.d2': 'z: {link: "./target.d2#/Before"}',
    'unlinked.d2': 'a: {link: ./missing.d2}',
  };
  check.start(snapshot(fs));
  await observed.settled();
  expect(observed.state).toMatchObject({ completed: 4, total: 4 });
  expect(observed.state.results.filter(result => result.path !== 'unlinked.d2').flatMap(result => result.diagnostics)
    .filter(item => item.source === 'Zoomflow missing-file-board')).toEqual([]);
  expect(observed.state.results.find(result => result.path === 'unlinked.d2')?.diagnostics[0].source).toBe('Zoomflow dangling-file-link');
  fs['target.d2'] = 'layers.After: {step}';
  check.start(snapshot(fs));
  await observed.settled();
  const broken = observed.state.results.flatMap(result => result.diagnostics).filter(item => item.source === 'Zoomflow missing-file-board');
  expect(broken.map(item => item.filename)).toEqual(['a.d2', 'z.d2']);
  for (const item of broken) {
    expect(item).toMatchObject({ severity: 'warning', line: 1 });
    expect(item.range).toBeDefined();
  }
});

it('continues after compile failures and resolves imported source locations against the imported file', async () => {
  const observed = observe();
  const check = createProjectCheck(compile, observed.changed);
  const fs = { 'index.d2': '# An unrelated line\n...@lib/nodes', 'lib/nodes.d2': 'a: {link: ./missing.d2}', 'broken.d2': 'broken: {' };
  check.start(snapshot(fs));
  await observed.settled();
  expect(observed.state.results.find(result => result.path === 'broken.d2')?.diagnostics[0]).toMatchObject({ severity: 'error', filename: 'broken.d2', line: 1 });
  const imported = observed.state.results.find(result => result.path === 'index.d2')!.diagnostics[0];
  expect(imported).toMatchObject({ filename: 'lib/nodes.d2', line: 1 });
  expect(imported.range).toBeDefined();
  expect(fs['lib/nodes.d2'].slice(imported.range!.from, imported.range!.to)).toBe('a');
});

it('snapshots unsaved sources, honours lint options, and clears completed results when sources change', async () => {
  const observed = observe();
  const check = createProjectCheck(compile, observed.changed);
  const fs = { 'index.d2': 'a: {link: root.layers.Detail}\nlayers.Detail: {step}' };
  const request = snapshot(fs);
  request.options.missingBacklink = true;
  check.start(request);
  fs['index.d2'] = 'New source';
  request.options.missingBacklink = false;
  await observed.settled();
  expect(observed.state.results[0].diagnostics.some(item => item.source === 'Zoomflow missing-backlink')).toBe(true);
  check.stop('changed');
  expect(observed.state).toMatchObject({ stopped: 'changed', results: [], running: false });
  check.start(request);
  await observed.settled();
  expect(observed.state.results[0].diagnostics).toEqual([]);
});

it('cancels queued compiles, discards late output, and serializes a subsequent check behind the running compile', async () => {
  const observed = observe();
  const delayed = gate();
  const calls = vi.fn(async (path: string, fs: Record<string, string>) => {
    if (fs[path] === 'Old') await delayed.promise;
    return compile(path, fs);
  });
  const check = createProjectCheck(calls, observed.changed);
  check.start(snapshot({ 'a.d2': 'Old', 'b.d2': 'Unused' }));
  await vi.waitFor(() => expect(calls).toHaveBeenCalledTimes(1));
  check.stop('cancelled');
  expect(observed.state).toMatchObject({ completed: 0, stopped: 'cancelled', running: false });
  check.start(snapshot({ 'new.d2': 'Current' }));
  expect(calls).toHaveBeenCalledTimes(1);
  delayed.resolve();
  await observed.settled();
  expect(calls).toHaveBeenCalledTimes(2);
  expect(observed.state.results.map(item => item.path)).toEqual(['new.d2']);
});

it('closing suppresses late publication and abandons every remaining file', async () => {
  const delayed = gate();
  const changed = vi.fn();
  const calls = vi.fn(async (path: string, fs: Record<string, string>) => { await delayed.promise; return compile(path, fs); });
  const check = createProjectCheck(calls, changed);
  check.start(snapshot({ 'a.d2': 'a', 'b.d2': 'b' }));
  await vi.waitFor(() => expect(calls).toHaveBeenCalledTimes(1));
  check.stop();
  const count = changed.mock.calls.length;
  delayed.resolve();
  await calls.mock.results[0].value;
  expect(calls).toHaveBeenCalledTimes(1);
  expect(changed).toHaveBeenCalledTimes(count);
});

it('separates engine failures from source issues and checks all files again on retry', async () => {
  const observed = observe();
  let unavailable = true;
  const calls = vi.fn(async (path: string, fs: Record<string, string>) => {
    if (unavailable) throw new CompilerStartupError(new Error('Worker unavailable'));
    return compile(path, fs);
  });
  const check = createProjectCheck(calls, observed.changed);
  const request = snapshot({ 'a.d2': 'a', 'b.d2': 'b' });
  check.start(request);
  await observed.settled();
  expect(observed.state).toMatchObject({ completed: 0, results: [], error: expect.stringContaining('diagram engine was unavailable') });
  unavailable = false;
  check.start(request);
  await observed.settled();
  expect(observed.state.completed).toBe(2);
  expect(observed.state.error).toBeUndefined();
});

it('includes project identity, every source and lint options in its freshness stamp', () => {
  const request = snapshot({ 'a.d2': 'a', 'b.d2': 'b' });
  const stamp = projectCheckStamp(request);
  expect(projectCheckStamp({ ...request, fs: { 'b.d2': 'b', 'a.d2': 'a' } })).toBe(stamp);
  expect(projectCheckStamp({ ...request, id: 'other' })).not.toBe(stamp);
  expect(projectCheckStamp({ ...request, fs: { ...request.fs, 'b.d2': 'New' } })).not.toBe(stamp);
  expect(projectCheckStamp({ ...request, options: { boundaryPorts: true } })).not.toBe(stamp);
});
