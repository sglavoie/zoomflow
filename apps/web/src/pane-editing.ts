import { indexShapeSources, lint, type CompileResponse, type LintOptions } from '@zoomflow/core';
import type { Viewer } from '@zoomflow/viewer';
import type { SourceEditor } from './editor';
import { compilerDiagnostics, lintDiagnostics, type SourceDiagnostic } from './diagnostics';
import { isEngineUnavailable } from './compiler';
import { AiError } from './ai-errors';
import { setupAiAssistant } from './ai-assistant';
import { atlasReadOnly, type PaneContext } from './document-pane-shared';
import type { PaneId, PaneScope } from './pane-scope';
import { describeError } from './text';

type Context = {
  formatButton: HTMLButtonElement;
  showsAtlas: () => boolean;
  setFormatStatus: (message: string, kind?: 'info' | 'error') => void;
  documentRevision: number;
  editor: SourceEditor;
  mappedSource: string | undefined;
  lintDocument: CompileResponse | undefined;
  compileSource: (source: string, context?: { inputPath: string; fs: Record<string, string> }) => Promise<CompileResponse>;
  picker: PaneContext['picker'];
  id: PaneId;
  part: PaneScope['part'];
  setActivity: (message: string, kind?: 'info' | 'error') => void;
  scope: PaneScope;
  documentName: string;
  viewer: Viewer;
  activeDiagnostics: SourceDiagnostic[];
  missingBacklink: HTMLInputElement;
  boundaryPorts: HTMLInputElement;
  lintFiles: (inputPath: string) => LintOptions['files'];
  showView: (view: 'preview' | 'source') => void;
};

/** Source formatting, clearing and AI edits share the pane's current compile and revision. */
export function setupPaneEditing(ctx: Context) {
  async function formatSource() {
    if (ctx.formatButton.disabled) return;
    if (ctx.showsAtlas()) { ctx.setFormatStatus(atlasReadOnly); return; }
    const revision = ctx.documentRevision;
    const document = ctx.editor.view.state.doc;
    const source = ctx.editor.source;
    ctx.formatButton.disabled = true;
    ctx.setFormatStatus('Formatting…');
    try {
      const compiled = ctx.mappedSource === source && ctx.lintDocument ? ctx.lintDocument : await ctx.compileSource(source);
      // Edits or opening another file invalidate this request, even after undo.
      if (ctx.editor.view.state.doc !== document || ctx.documentRevision !== revision) return;
      const formatted = compiled.fs[compiled.inputPath];
      if (typeof formatted !== 'string') throw new Error('D2 did not return formatted source.');
      ctx.setFormatStatus(ctx.editor.format(formatted) ? 'Source formatted.' : 'Source is already formatted.');
    } catch (error) {
      if (ctx.editor.view.state.doc !== document || ctx.documentRevision !== revision) return;
      // A restart or closed workspace says nothing about the source.
      if (isEngineUnavailable(error)) { ctx.setFormatStatus('Formatting stopped because the diagram engine was unavailable. Try again.', 'error'); return; }
      ctx.setFormatStatus(`Formatting failed: ${compilerDiagnostics(error, source, ctx.picker().inputPath(ctx.id)).map((item) => item.message).join('\n')}`, 'error');
    } finally { ctx.formatButton.disabled = false; }
  }
  ctx.formatButton.addEventListener('click', () => void formatSource());
  ctx.part('clear-source').addEventListener('click', () => {
    if (ctx.showsAtlas()) return;
    if (ctx.editor.replaceSource('', 'delete.clear')) ctx.setActivity('Source cleared. Undo with ⌘Z / Ctrl+Z.');
    ctx.editor.view.focus();
  });
  const ai = setupAiAssistant(ctx.scope, {
    read: () => ({ source: ctx.editor.source, name: ctx.documentName, board: ctx.viewer.currentBoard?.id ?? 'root', revision: ctx.documentRevision }),
    diagnostics: async (source) => {
      if (ctx.lintDocument && ctx.mappedSource === source) return ctx.activeDiagnostics;
      const context = ctx.picker().compilation(ctx.id);
      const options = { missingBacklink: ctx.missingBacklink.checked, boundaryPorts: ctx.boundaryPorts.checked, files: ctx.lintFiles(context.inputPath) };
      try {
        const compiled = await ctx.compileSource(source, context);
        const sources = indexShapeSources(compiled.diagram, compiled.graph, source, compiled.inputPath);
        return lintDiagnostics(lint(compiled, options).diagnostics, source, sources, compiled.inputPath);
      } catch (error) {
        if (isEngineUnavailable(error)) throw new AiError('The diagram engine is unavailable, so diagnostics could not be checked. Retry the preview, then send again.', describeError(error));
        return compilerDiagnostics(error, source, context.inputPath);
      }
    },
    validate: async (source) => {
      try { await ctx.compileSource(source); }
      catch (error) {
        if (!isEngineUnavailable(error)) throw error;
        throw new AiError('The diagram engine is unavailable, so the AI change could not be checked. Your source is unchanged; retry the preview, then send again.', describeError(error));
      }
    },
    apply: (source) => ctx.editor.applyAi(source),
    readOnly: () => ctx.showsAtlas() ? atlasReadOnly : undefined,
    onStatus: (message, kind) => ctx.setActivity(message, kind),
    undo: () => ctx.editor.undo(),
    revealChange: () => { ctx.showView('source'); ctx.editor.revealAiChange(); },
    dismissHighlights: () => ctx.editor.clearAiHighlights(),
  });
  return { formatSource, ai };
}
