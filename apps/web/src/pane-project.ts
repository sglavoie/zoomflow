import { indexBoards, lint, rebaseFileLinks, resolveFilePath, type CompileResponse } from '@zoomflow/core';
import type { Viewer, RenderBoard, ViewerRoute } from '@zoomflow/viewer';
import type { SourceEditor } from './editor';
import { isEngineUnavailable } from './compiler';
import { newProjectPath, projectIdOf, projectPathOf } from './project-files';
import type { setupBoardTools } from './board-tools';
import { boardRoute } from './link-preview';
import { createProjectFile } from './file-handles';
import { atlasMapName, atlasMapSource, fileLinks as linksOfFile, type AtlasFile } from './atlas-map';
import type { PaneId } from './pane-scope';
import { describeError, plural } from './text';
import type { ProjectSearchEntry } from './project-search';
import { compiledBoards, siblingKey, projectLabel, type FileVisit, type PaneContext, type DocumentExport } from './document-pane-shared';

interface Context {
  picker: PaneContext['picker'];
  id: PaneId;
  currentDocumentKey: string | undefined;
  shared: PaneContext;
  setActivity: (message: string, kind?: 'info' | 'error') => void;
  linkedCompiles: Map<string, { sources: string; result: Promise<{ boards: ReturnType<typeof indexBoards>; render: RenderBoard; }>; }>;
  compileSource: (source: string, context?: { inputPath: string; fs: Record<string, string> }) => Promise<CompileResponse>;
  fileStack: FileVisit[];
  viewer: Viewer;
  replaceDocument: (source: string, name: string, key: string, reset?: boolean, route?: ViewerRoute, stack?: FileVisit[]) => Promise<void>;
  boardTools: ReturnType<typeof setupBoardTools>;
  documentOpens: number;
  editor: SourceEditor;
  mappedSource: string | undefined;
  sourceError: boolean;
  atlasRequest: number;
  showView: (view: 'preview' | 'source') => void;
}

export function setupPaneProject(ctx: Context) {
  /** The project files of this pane's document, by project path; undefined outside a folder project. */
  function projectSources() {
    return ctx.picker().projectName(ctx.id) === undefined && ctx.picker().atlasProject(ctx.id) === undefined ? undefined : ctx.picker().compilation(ctx.id);
  }

  /** The pane shows a project's generated atlas map, which is read-only and never saved. */
  const showsAtlas = () => ctx.currentDocumentKey?.startsWith('atlas:') === true;

  /** The project path a file link of this document opens, when it stays inside the project. */
  const linkedPath = (path: string) => projectSources() && resolveFilePath(ctx.picker().inputPath(ctx.id), path);

  const fileLabel = (path: string) => projectLabel(linkedPath(path) ?? path.replace(/^.*\//, ''));

  /** The boards below a project file's root, named from the root down, for choosing where a link opens. */
  async function linkedBoards(path: string) {
    const { boards } = await compileLinkedFile(path);
    const names = (id: string): string[] => {
      const board = boards.get(id)!;
      return board.parent ? [...names(board.parent), board.kind === 'layers' ? board.name : `${board.name} (${board.kind === 'scenarios' ? 'scenario' : 'step'})`] : [];
    };
    return [...boards.values()].filter((board) => board.parent).map((board) => ({ hash: board.hash, label: names(board.id).join(' › ') }));
  }

  /** Create a project file beside this one, in the project's folder when the browser can write it, otherwise as a
   * draft that Save asks where to put. Resolves its project path. */
  async function createLinkedFile(name: string, source: string) {
    const context = projectSources();
    const projectId = ctx.currentDocumentKey && projectIdOf(ctx.currentDocumentKey);
    if (!context || !projectId) return;
    const taken = new Set(Object.keys(context.fs));
    const folder = ctx.shared.directoryHandles.get(projectId);
    try {
      for (;;) {
        const path = newProjectPath(context.inputPath, name, taken);
        const created = folder ? await createProjectFile(folder, path, source) : 'refused';
        if (created === 'exists') { taken.add(path); continue; }
        const key = ctx.picker().addProjectFile(projectId, path, source, created !== 'refused');
        if (!key) return;
        if (created !== 'refused') ctx.shared.fileHandles.set(key, created);
        else if (folder) ctx.setActivity(`Created ${path} as a draft. Save it to keep it.`);
        return path;
      }
    } catch (error) {
      ctx.setActivity(`Could not create a linked diagram: ${describeError(error)}`, 'error');
    }
  }

  function compileLinkedFile(path: string) {
    const context = projectSources()!;
    const source = context.fs[path]!;
    const key = siblingKey(ctx.currentDocumentKey!, path);
    const sources = JSON.stringify(Object.entries(context.fs).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0));
    const cached = ctx.linkedCompiles.get(key);
    if (cached?.sources === sources) return cached.result;
    const result = (async () => {
      const { d2 } = await ctx.shared.compiler.get();
      const compiled = await ctx.compileSource(source, { inputPath: path, fs: context.fs });
      const diagram = rebaseFileLinks(compiled, path);
      const boards = indexBoards(diagram);
      compiledBoards.set(key, new Set([...boards.values()].map((board) => board.hash)));
      const render: RenderBoard = (target) => d2.render(diagram, { ...compiled.renderOptions, target, noXMLTag: true });
      return { boards, render };
    })();
    ctx.linkedCompiles.set(key, { sources, result });
    void result.catch(() => { if (ctx.linkedCompiles.get(key)?.result === result) ctx.linkedCompiles.delete(key); });
    return result;
  }

  /** Compile another file of this pane's folder project for an export that follows file links. */
  async function compileProjectFile(path: string, fs: Record<string, string>): Promise<Pick<DocumentExport, 'diagram' | 'render' | 'diagnostics'>> {
    const { d2 } = await ctx.shared.compiler.get();
    const compiled = await ctx.compileSource(fs[path]!, { inputPath: path, fs });
    const diagram = rebaseFileLinks(compiled, path);
    const render: RenderBoard = (target) => d2.render(diagram, { ...compiled.renderOptions, target, noXMLTag: true });
    return { diagram, render, diagnostics: lint(compiled, { files: lintFiles(path) }).diagnostics };
  }

  function setFileStack(stack: FileVisit[]) {
    ctx.fileStack = stack;
    ctx.viewer.setTrailPrefix(stack.map((visit, index) => ({ name: projectLabel(visit.path), activate: () => void returnToFile(index) })));
  }

  /** Open another file of the project in this pane at `route`, coming from the files in `stack`.
   * The first pane records it as a history entry, so Back returns to the file before. */
  async function visitFile(target: { source: string; name: string; key: string }, route: ViewerRoute, stack: FileVisit[]) {
    if (ctx.id === 'a') history.pushState({ zoomflowFile: target.key, zoomflowFiles: stack, zoomflowTrail: route.trail }, '',
      `${location.pathname}${location.search}${route.hash}`);
    await ctx.replaceDocument(target.source, target.name, target.key, false, route, stack);
  }

  /** A search jump follows the same file history as a link, including a way back from an unlinked file. */
  async function openProjectMatch(entry: ProjectSearchEntry) {
    if (entry.file === ctx.picker().inputPath(ctx.id) && !showsAtlas()) {
      await ctx.boardTools.revealSearchMatch(entry);
      return;
    }
    const here: FileVisit = { key: ctx.currentDocumentKey!, path: showsAtlas() ? atlasMapName : ctx.picker().inputPath(ctx.id), route: ctx.viewer.route };
    const target = ctx.picker().selectProjectPath(ctx.id, entry.file);
    if (!target) { ctx.viewer.setMessage(`Missing file: ${entry.file}`, true); return; }
    if (target.pane !== ctx.id) { await ctx.shared.revealMatch(target.pane, entry); return; }
    const earlier = ctx.fileStack.findIndex(visit => visit.key === target.key);
    const stack = earlier >= 0 ? ctx.fileStack.slice(0, earlier) : [...ctx.fileStack, here];
    const opening = visitFile(target, { hash: entry.hash, trail: entry.trail }, stack);
    const request = ctx.documentOpens;
    await opening;
    if (ctx.documentOpens !== request || ctx.currentDocumentKey !== target.key || ctx.editor.source !== target.source || ctx.mappedSource !== ctx.editor.source || ctx.sourceError) return;
    // The file visit already pushed history; revealing its shape keeps that single entry.
    await ctx.boardTools.revealSearchMatch(entry, 'replace');
  }

  function openFileLink(path: string, hash: string) {
    const resolved = linkedPath(path);
    // Before the picker switches this pane to the target.
    const here: FileVisit = { key: ctx.currentDocumentKey!, path: ctx.picker().inputPath(ctx.id), route: ctx.viewer.route };
    const target = resolved && ctx.picker().selectProjectPath(ctx.id, resolved);
    if (!target) { ctx.viewer.setMessage(`Missing file: ${fileLabel(path)}`, true); return; }
    if (target.pane !== ctx.id) { ctx.viewer.setMessage(`${target.name} is open in the other pane.`, true); return; }
    // Coming back to a file on the way here shortens the way instead of repeating it.
    const earlier = ctx.fileStack.findIndex((visit) => visit.key === target.key);
    // A file opened from the atlas map starts a new way through files, as one chosen from the menu does.
    const stack = showsAtlas() ? [] : target.key === ctx.currentDocumentKey ? ctx.fileStack : earlier >= 0 ? ctx.fileStack.slice(0, earlier) : [...ctx.fileStack, here];
    void visitFile(target, { hash: boardRoute(hash) }, stack);
  }

  /** Reopen a file on the way here at the board it was left on. */
  async function returnToFile(index: number) {
    const visit = ctx.fileStack[index];
    // By key, so a recovered copy on the way here reopens itself rather than the file it copies.
    const target = visit && (visit.key.startsWith('atlas:') ? ctx.picker().showAtlas(ctx.id, projectIdOf(visit.key)!)
      : ctx.picker().selectProjectPath(ctx.id, visit.path, visit.key));
    if (!target || target.pane !== ctx.id) {
      ctx.viewer.setMessage(target ? `${target.name} is open in the other pane.` : `Missing file: ${projectLabel(visit.path)}`, true);
      return;
    }
    await visitFile(target, visit.route, ctx.fileStack.slice(0, index));
  }

  /** Files on the way here as a history entry recorded them, keeping those the project still has. */
  function savedStack(value: unknown): FileVisit[] {
    if (!Array.isArray(value)) return [];
    return value.filter((visit): visit is FileVisit => typeof visit?.key === 'string' && typeof visit.path === 'string' &&
      typeof visit.route?.hash === 'string' && ctx.picker().hasDraft(visit.key));
  }

  /** Back or Forward reached an entry of another file: open it when it belongs to this pane's project. */
  function restoreFromHistory(state: { zoomflowFile: string } & Record<string, unknown>) {
    const key = state.zoomflowFile;
    // Project files, the atlas map and recovered copies of project files all name their project.
    const project = projectIdOf(key);
    if (project === undefined || project !== projectIdOf(ctx.currentDocumentKey ?? '')) return false;
    const path = projectPathOf(key);
    const target = key.startsWith('atlas:') ? ctx.picker().showAtlas(ctx.id, project)
      : path !== undefined ? ctx.picker().selectProjectPath(ctx.id, path, key) : undefined;
    if (!target || target.pane !== ctx.id) return false;
    void ctx.replaceDocument(target.source, target.name, target.key, false, ctx.viewer.route, savedStack(state.zoomflowFiles));
    return true;
  }

  /** Draw a project's atlas map from its files' latest sources, compiling each file to find its links, and show it. */
  async function openAtlasMap(projectId: string) {
    const request = ++ctx.atlasRequest;
    // Opening another document or closing the pane while files compile abandons the map.
    const from = ctx.documentOpens;
    const current = () => request === ctx.atlasRequest && ctx.documentOpens === from;
    const { fs, home } = ctx.picker().projectSources(projectId);
    const paths = Object.keys(fs).sort((a, b) => a.localeCompare(b));
    const files: AtlasFile[] = [];
    try {
      for (const [index, path] of paths.entries()) {
        ctx.setActivity(`Drawing the atlas map: ${path} (${index + 1} of ${paths.length})…`);
        try {
          const compiled = await ctx.compileSource(fs[path], { inputPath: path, fs });
          files.push({ path, links: linksOfFile(rebaseFileLinks(compiled, path), path) });
        } catch (error) {
          // A restart that cuts a compile short says nothing about the file's source.
          if (isEngineUnavailable(error)) throw error;
          files.push({ path, links: [], failed: true });
        }
        if (!current()) return;
      }
    } catch (error) {
      if (current()) ctx.setActivity(`Could not draw the atlas map: ${describeError(error)}`, 'error');
      return;
    }
    const target = ctx.picker().showAtlas(ctx.id, projectId, atlasMapSource(files, home));
    if (!target) { ctx.setActivity(''); return; }
    if (target.pane !== ctx.id) { ctx.setActivity(`${target.name} is open in the other pane.`); return; }
    const failed = files.filter((file) => file.failed).length;
    ctx.setActivity(failed ? `${plural(failed, 'file')} did not compile, so ${failed === 1 ? 'its links are' : 'their links are'} left out.` : '');
    await ctx.replaceDocument(target.source, target.name, target.key, true);
    ctx.showView('preview');
  }

  /** The project around a compiled file, so lint checks its links to other files. */
  function lintFiles(inputPath: string) {
    const context = projectSources();
    const key = ctx.currentDocumentKey;
    if (!context || !key) return undefined;
    return { inputPath, exists: (path: string) => Object.hasOwn(context.fs, path), boards: (path: string) => compiledBoards.get(siblingKey(key, path)) };
  }
  return { projectSources, showsAtlas, linkedPath, fileLabel, linkedBoards, createLinkedFile, compileLinkedFile, compileProjectFile, setFileStack, visitFile, openProjectMatch, openFileLink, returnToFile, savedStack, restoreFromHistory, openAtlasMap, lintFiles };
}
