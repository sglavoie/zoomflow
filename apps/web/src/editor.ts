import { basicSetup } from 'codemirror';
import { EditorState, Transaction } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { lintGutter, openLintPanel, setDiagnostics, type Diagnostic } from '@codemirror/lint';
import { parseSourceRange, type SourceRange, type LintDiagnostic, type ShapeSource } from '@zoomflow/core';

export function lintDiagnostics(items: LintDiagnostic[], source: string, sources: ShapeSource[]): Diagnostic[] {
  return items.map((item) => {
    const range = (item.range && parseSourceRange(item.range, source)) ||
      sources.find((entry) => entry.board === item.board && entry.shape === item.shape) ||
      { from: 0, to: Math.min(1, source.length) };
    return { from: range.from, to: range.to, severity: item.severity, source: `Zoomflow ${item.rule}`,
      message: `${item.board}: ${item.message}` };
  });
}

export function compilerDiagnostics(error: unknown, source: string): Diagnostic[] {
  const message = String(error);
  try {
    const entries: unknown = JSON.parse(message.slice(message.indexOf('[')));
    if (Array.isArray(entries)) {
      const diagnostics = entries.flatMap((entry) => {
        if (typeof entry?.range !== 'string' || typeof entry?.errmsg !== 'string') return [];
        const range = parseSourceRange(entry.range, source);
        return range ? [{ ...range, severity: 'error' as const, message: entry.errmsg }] : [];
      });
      if (diagnostics.length) return diagnostics;
    }
  } catch { /* Non-parser failures still appear in the banner and editor. */ }
  return [{ from: 0, to: Math.min(1, source.length), severity: 'error', message }];
}

export class SourceEditor {
  readonly view: EditorView;
  private selectingShape = false;
  constructor(parent: HTMLElement, source: string, changed: () => void, selected: () => void) {
    this.view = new EditorView({
      parent,
      state: EditorState.create({ doc: source, extensions: [
        basicSetup, lintGutter(), EditorView.lineWrapping,
        EditorView.contentAttributes.of({ 'aria-label': 'D2 source', 'aria-multiline': 'true' }),
        EditorView.theme({
          '&': { height: '100%', backgroundColor: 'transparent', color: 'inherit' },
          '.cm-scroller': { overflow: 'auto', fontFamily: 'monospace' },
          '.cm-gutters': { backgroundColor: 'transparent', color: '#7a899d', borderColor: '#8192a444' },
          '.cm-activeLine, .cm-activeLineGutter': { backgroundColor: '#8192a418' },
          '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection': { backgroundColor: '#477de544' },
          '.cm-cursor': { borderLeftColor: 'currentColor' },
          '.cm-tooltip': { backgroundColor: 'Canvas', color: 'CanvasText' },
        }),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) changed();
          else if (update.selectionSet && !this.selectingShape) selected();
        }),
      ] }),
    });
  }
  get source() { return this.view.state.doc.toString(); }
  get selection() { return this.view.state.selection.main; }
  replace(source: string) {
    this.view.dispatch({ changes: { from: 0, to: this.view.state.doc.length, insert: source },
      selection: { anchor: 0 }, annotations: Transaction.addToHistory.of(false) });
  }
  select(range: SourceRange, focus: boolean) {
    this.selectingShape = true;
    try {
      this.view.dispatch({ selection: { anchor: range.from, head: range.to }, scrollIntoView: true });
      if (focus) this.view.focus();
    } finally { this.selectingShape = false; }
  }
  diagnostics(diagnostics: Diagnostic[]) { this.view.dispatch(setDiagnostics(this.view.state, diagnostics)); }
  showDiagnostics() { openLintPanel(this.view); }
  destroy() { this.view.destroy(); }
}
