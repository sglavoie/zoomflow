import { expect, it, vi } from 'vitest';
import { CompilerStartupError } from '../src/compiler';
import { createProjectSearch, type ProjectSearchState } from '../src/project-search';

const entry = (label: string) => ({ board: 'root', trail: ['root'], breadcrumb: 'Root', label, shape: 'step', hash: '#/' });
function gate() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}
function observe() {
  let state!: ProjectSearchState;
  return { changed(next: ProjectSearchState) { state = next; }, get state() { return state; },
    async settled() { await vi.waitFor(() => expect(state.indexing).toBe(false)); } };
}

it('searches all files, publishes incremental results and reuses successful compiles on reopening', async () => {
  const observed = observe();
  const delayed = gate();
  const compile = vi.fn(async (path: string, fs: Record<string, string>) => {
    if (path === 'unlinked.d2') await delayed.promise;
    return [entry(fs[path])];
  });
  const search = createProjectSearch(compile, observed.changed);
  const snapshot = { id: 'project', fs: { 'unlinked.d2': 'Refund approval', 'index.d2': 'Home' } };
  search.start(snapshot);
  await vi.waitFor(() => expect(compile).toHaveBeenCalledTimes(2));
  expect(observed.state.entries).toEqual([{ ...entry('Home'), file: 'index.d2' }]);
  expect(observed.state).toMatchObject({ completed: 1, total: 2, indexing: true, path: 'unlinked.d2' });
  delayed.resolve();
  await observed.settled();
  expect(observed.state.entries.map(item => item.file)).toEqual(['index.d2', 'unlinked.d2']);
  search.stop();
  search.start(snapshot);
  expect(observed.state).toMatchObject({ completed: 2, total: 2, indexing: false });
  expect(compile).toHaveBeenCalledTimes(2);
});

it('invalidates every file when an import changes and snapshots the sources passed to the compiler', async () => {
  const observed = observe();
  const compile = vi.fn(async (_path: string, fs: Record<string, string>) => [entry(fs['lib.d2'])]);
  const search = createProjectSearch(compile, observed.changed);
  const fs = { 'index.d2': '...@lib', 'lib.d2': 'Before' };
  search.start({ id: 'project', fs });
  fs['lib.d2'] = 'After';
  await observed.settled();
  expect(observed.state.entries.map(item => item.label)).toEqual(['Before', 'Before']);
  search.start({ id: 'project', fs });
  expect(observed.state.entries).toEqual([]);
  await observed.settled();
  expect(observed.state.entries.map(item => item.label)).toEqual(['After', 'After']);
  expect(compile).toHaveBeenCalledTimes(4);
  search.start({ id: 'other project', fs });
  await observed.settled();
  expect(compile).toHaveBeenCalledTimes(6);
});

it('coalesces changed snapshots behind one running compile and discards stale results', async () => {
  const observed = observe();
  const delayed = gate();
  const compile = vi.fn(async (_path: string, fs: Record<string, string>) => {
    if (fs['index.d2'] === 'Old') await delayed.promise;
    return [entry(fs['index.d2'])];
  });
  const search = createProjectSearch(compile, observed.changed);
  search.start({ id: 'project', fs: { 'index.d2': 'Old', 'other.d2': 'Old other' } });
  await vi.waitFor(() => expect(compile).toHaveBeenCalledTimes(1));
  search.start({ id: 'project', fs: { 'index.d2': 'Intervening' } });
  search.start({ id: 'project', fs: { 'index.d2': 'Newest' } });
  expect(compile).toHaveBeenCalledTimes(1);
  expect(observed.state.entries).toEqual([]);
  delayed.resolve();
  await observed.settled();
  expect(compile).toHaveBeenCalledTimes(2);
  expect(observed.state.entries.map(item => item.label)).toEqual(['Newest']);
});

it('closing search stops queued work and publication from a compile already running', async () => {
  const delayed = gate();
  const changed = vi.fn();
  const compile = vi.fn(async () => { await delayed.promise; return [entry('Late')]; });
  const search = createProjectSearch(compile, changed);
  search.start({ id: 'project', fs: { 'a.d2': 'a', 'b.d2': 'b' } });
  await vi.waitFor(() => expect(compile).toHaveBeenCalledTimes(1));
  search.stop();
  const publications = changed.mock.calls.length;
  delayed.resolve();
  await new Promise(resolve => setTimeout(resolve, 20));
  expect(compile).toHaveBeenCalledTimes(1);
  expect(changed).toHaveBeenCalledTimes(publications);
});

it('reports broken files without hiding successful results, and retries only the failed compiles', async () => {
  const observed = observe();
  let broken = true;
  const compile = vi.fn(async (path: string) => {
    if (path === 'bad.d2' && broken) throw new Error('Unclosed block');
    return [entry(path)];
  });
  const search = createProjectSearch(compile, observed.changed);
  const snapshot = { id: 'project', fs: { 'bad.d2': 'bad', 'good.d2': 'good' } };
  search.start(snapshot);
  await observed.settled();
  expect(observed.state).toMatchObject({ completed: 2, total: 2, failures: [{ path: 'bad.d2', message: 'Unclosed block' }] });
  expect(observed.state.entries.map(item => item.file)).toEqual(['good.d2']);
  broken = false;
  search.start(snapshot, true);
  await observed.settled();
  expect(compile).toHaveBeenCalledTimes(3);
  expect(observed.state.failures).toEqual([]);
  expect(observed.state.entries).toHaveLength(2);
});

it('engine failures stop indexing without diagnosing the file and can be retried', async () => {
  const observed = observe();
  let unavailable = true;
  const compile = vi.fn(async () => {
    if (unavailable) throw new CompilerStartupError(new Error('Worker unavailable'));
    return [entry('Recovered')];
  });
  const search = createProjectSearch(compile, observed.changed);
  const snapshot = { id: 'project', fs: { 'a.d2': 'a', 'b.d2': 'b' } };
  search.start(snapshot);
  await observed.settled();
  expect(observed.state.failures).toEqual([]);
  expect(observed.state.error).toContain('diagram engine was unavailable');
  expect(compile).toHaveBeenCalledTimes(1);
  unavailable = false;
  search.start(snapshot, true);
  await observed.settled();
  expect(observed.state.entries).toHaveLength(2);
  expect(observed.state.error).toBeUndefined();
});

it('shows readable parser diagnostics rather than the worker JSON payload', async () => {
  const observed = observe();
  const search = createProjectSearch(async () => {
    throw new Error(JSON.stringify([{ range: 'bad.d2,0:0:0-0:1:1', errmsg: 'Unclosed block' }]));
  }, observed.changed);
  search.start({ id: 'project', fs: { 'bad.d2': 'broken: {' } });
  await observed.settled();
  expect(observed.state.failures).toEqual([{ path: 'bad.d2', message: 'Unclosed block' }]);
});
