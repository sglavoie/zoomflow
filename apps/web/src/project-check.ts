import { indexBoards, indexShapeSources, lint, parseSourceRange, type CompileResponse, type LintOptions } from '@zoomflow/core';
import { isEngineUnavailable } from './compiler';
import { compilerDiagnostics, lintDiagnostics, type SourceDiagnostic } from './diagnostics';

export type ProjectCheckSnapshot = {
  id: string;
  fs: Record<string, string>;
  options: Pick<LintOptions, 'missingBacklink' | 'boundaryPorts'>;
};
export type ProjectCheckState = {
  completed: number;
  total: number;
  path?: string;
  running: boolean;
  results: { path: string; diagnostics: SourceDiagnostic[] }[];
  stopped?: 'cancelled' | 'changed';
  error?: string;
};
export type ProjectCheckHost = {
  available: () => boolean;
  read: () => ProjectCheckSnapshot | undefined;
  compile: (path: string, fs: Record<string, string>) => Promise<CompileResponse>;
  activate: (item: SourceDiagnostic) => Promise<void>;
};

export function projectCheckStamp(snapshot: ProjectCheckSnapshot) {
  return JSON.stringify([snapshot.id, Object.entries(snapshot.fs).sort(([a], [b]) => a.localeCompare(b)),
    Boolean(snapshot.options.missingBacklink), Boolean(snapshot.options.boundaryPorts)]);
}

/** Compile one immutable snapshot before linting it: cross-file board checks must never depend on which files
 * the user visited, nor on their compile order. Cancellation abandons queued work and late publication. */
export function createProjectCheck(compile: ProjectCheckHost['compile'], changed: (state: ProjectCheckState) => void) {
  type Job = { snapshot: ProjectCheckSnapshot; state: ProjectCheckState };
  let active: Job | undefined;
  let draining = false;
  let state: ProjectCheckState | undefined;
  function publish(job: Job, update: Partial<ProjectCheckState>) {
    job.state = { ...job.state, ...update };
    state = job.state;
    changed(state);
  }
  function located(items: SourceDiagnostic[], path: string, fs: Record<string, string>) {
    return items.map(item => {
      const filename = item.filename ?? path;
      return { ...item, filename, range: item.rawRange
        ? parseSourceRange(item.rawRange, fs[filename] ?? '', filename) : item.range };
    });
  }
  async function drain() {
    if (draining) return;
    draining = true;
    try {
      while (active) {
        const job = active;
        const { fs, options } = job.snapshot;
        const compiled = new Map<string, CompileResponse>();
        const boards = new Map<string, ReadonlySet<string>>();
        const results = new Map<string, SourceDiagnostic[]>();
        const paths = Object.keys(fs).sort((a, b) => a.localeCompare(b));
        const report = () => paths.filter(path => results.has(path)).map(path => ({ path, diagnostics: results.get(path)! }));
        for (const path of paths) {
          if (active !== job) break;
          publish(job, { path });
          // Let input and preview work run between files, including Cancel before the first compile starts.
          await new Promise(resolve => setTimeout(resolve, 0));
          if (active !== job) break;
          try {
            const result = await compile(path, fs);
            if (active !== job) break;
            compiled.set(path, result);
            boards.set(path, new Set([...indexBoards(result.diagram).values()].map(board => board.hash)));
          } catch (error) {
            if (active !== job) break;
            if (isEngineUnavailable(error)) {
              publish(job, { running: false, path: undefined,
                error: 'Check stopped because the diagram engine was unavailable. Retry the preview, then check again.' });
              active = undefined;
              break;
            }
            results.set(path, located(compilerDiagnostics(error, fs[path], path), path, fs));
          }
          publish(job, { completed: job.state.completed + 1, results: report() });
        }
        if (active !== job) continue;
        for (const [path, result] of compiled) {
          const diagnostics = lint(result, { ...options, files: { inputPath: path,
            exists: file => Object.hasOwn(fs, file), boards: file => boards.get(file) } }).diagnostics;
          const sources = indexShapeSources(result.diagram, result.graph, fs[path], path);
          results.set(path, located(lintDiagnostics(diagnostics, fs[path], sources, path), path, fs));
        }
        publish(job, { running: false, path: undefined, results: report() });
        active = undefined;
      }
    } finally { draining = false; }
  }
  return {
    start(snapshot: ProjectCheckSnapshot) {
      active = { snapshot: { ...snapshot, fs: { ...snapshot.fs }, options: { ...snapshot.options } }, state: {
        completed: 0, total: Object.keys(snapshot.fs).length, running: true, results: [],
      } };
      publish(active, {});
      void drain();
    },
    stop(reason?: ProjectCheckState['stopped']) {
      active = undefined;
      if (reason && state) {
        state = { ...state, running: false, path: undefined, stopped: reason, error: undefined,
          ...(reason === 'changed' ? { results: [] } : {}) };
        changed(state);
      }
    },
  };
}
