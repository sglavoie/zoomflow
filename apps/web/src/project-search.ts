import type { DiagramSearchEntry } from '@zoomflow/core';
import { isEngineUnavailable } from './compiler';
import { compilerDiagnostics } from './diagnostics';

export type ProjectSearchEntry = DiagramSearchEntry & { file: string; hash: string };
export type ProjectSearchSnapshot = { id: string; fs: Record<string, string> };
export type ProjectSearchState = {
  entries: ProjectSearchEntry[];
  completed: number;
  total: number;
  path?: string;
  indexing: boolean;
  failures: { path: string; message: string }[];
  error?: string;
};
export type ProjectSearchHost = {
  available: () => boolean;
  read: () => ProjectSearchSnapshot | undefined;
  compile: (path: string, fs: Record<string, string>) => Promise<Omit<ProjectSearchEntry, 'file'>[]>;
  activate: (entry: ProjectSearchEntry) => Promise<void>;
};

/** Index on demand, with at most one compile outstanding. Every source belongs to the cache key:
 * changing an import can change labels in any diagram, even when that diagram's own source is unchanged.
 * Closing search abandons publication and queued work; a compile already in the worker may finish. */
export function createProjectSearch(compile: ProjectSearchHost['compile'], changed: (state: ProjectSearchState) => void) {
  type Job = { stamp: string; fs: Record<string, string>; paths: string[]; state: ProjectSearchState };
  let active: Job | undefined;
  let running = false;
  let cacheStamp: string | undefined;
  const cache = new Map<string, ProjectSearchEntry[]>();

  async function drain() {
    if (running) return;
    running = true;
    try {
      while (active?.state.indexing) {
        const job = active;
        const path = job.paths.shift();
        if (path === undefined) {
          job.state = { ...job.state, indexing: false, path: undefined };
          changed(job.state);
          continue;
        }
        job.state = { ...job.state, path };
        changed(job.state);
        // Give input, previews and closing the dialog a turn between files.
        await new Promise(resolve => setTimeout(resolve, 0));
        if (active !== job) continue;
        try {
          const entries = (await compile(path, job.fs)).map(entry => ({ ...entry, file: path }));
          if (active !== job) continue;
          cache.set(path, entries);
          job.state = { ...job.state, entries: Object.keys(job.fs).flatMap(file => cache.get(file) ?? []), completed: job.state.completed + 1 };
        } catch (error) {
          if (active !== job) continue;
          if (isEngineUnavailable(error)) {
            job.state = { ...job.state, indexing: false, path: undefined,
              error: 'Search stopped because the diagram engine was unavailable. Retry the preview, then retry search.' };
          } else {
            job.state = { ...job.state, completed: job.state.completed + 1,
              failures: [...job.state.failures, { path, message: compilerDiagnostics(error, job.fs[path], path).map(item => item.message).join('\n') }] };
          }
        }
        if (active === job) changed(job.state);
      }
    } finally { running = false; }
  }

  return {
    start(snapshot: ProjectSearchSnapshot, retry = false) {
      const files = Object.entries(snapshot.fs).sort(([a], [b]) => a.localeCompare(b));
      const stamp = JSON.stringify([snapshot.id, files]);
      if (active?.stamp === stamp && !retry) return;
      if (cacheStamp !== stamp) { cache.clear(); cacheStamp = stamp; }
      const paths = files.map(([path]) => path);
      const pending = paths.filter(path => !cache.has(path));
      active = { stamp, fs: Object.fromEntries(files), paths: pending, state: {
        entries: paths.flatMap(path => cache.get(path) ?? []), completed: paths.length - pending.length,
        total: paths.length, indexing: pending.length > 0, failures: [],
      } };
      changed(active.state);
      void drain();
    },
    stop() { active = undefined; },
  };
}
