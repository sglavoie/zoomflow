import { basicSetup } from 'codemirror';
import { EditorState, type Extension } from '@codemirror/state';
import { EditorView, keymap } from '@codemirror/view';
import { isolateHistory, undo } from '@codemirror/commands';
import { lintGutter, openLintPanel, closeLintPanel, setDiagnostics, type Diagnostic } from '@codemirror/lint';
import { parseSourceRange, type SourceRange, type LintDiagnostic, type ShapeSource } from '@zoomflow/core';
import { d2Language } from './d2-language';

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
  private readonly extensions: Extension[];
  private currentKey = '';
  private readonly documents = new Map<string, { state: EditorState; scroll: ReturnType<EditorView['scrollSnapshot']> }>();
  constructor(parent: HTMLElement, source: string, changed: () => void, selected: () => void, format: () => void) {
    this.extensions = [
        basicSetup, d2Language, lintGutter(), EditorView.lineWrapping,
        keymap.of([{ key: 'Shift-Alt-f', run: () => { format(); return true; } }]),
        EditorView.contentAttributes.of({ 'aria-label': 'D2 source', 'aria-multiline': 'true' }),
        EditorView.domEventHandlers({ focus: (_event, view) => {
          const { scrollTop, scrollLeft } = view.scrollDOM;
          const document = view.state.doc;
          // WebKit scrolls contenteditable back to its start after native focus.
          // Preserve the viewport; explicit CodeMirror scroll effects still run
          // during its next layout pass (for example, selecting a diagram shape).
          queueMicrotask(() => {
            if (view.hasFocus && view.state.doc === document) view.scrollDOM.scrollTo(scrollLeft, scrollTop);
          });
        } }),
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
      ];
    this.view = new EditorView({ parent, state: EditorState.create({ doc: source, extensions: this.extensions }) });
  }
  get source() { return this.view.state.doc.toString(); }
  get selection() { return this.view.state.selection.main; }
  open(key: string, source: string, reset = false) {
    const active = document.activeElement;
    const editing = this.view.hasFocus;
    const diagnosticsOpen = Boolean(this.view.dom.querySelector('.cm-panel-lint'));
    if (this.currentKey) this.documents.set(this.currentKey, { state: this.view.state, scroll: this.view.scrollSnapshot() });
    const saved = reset ? undefined : this.documents.get(key);
    this.currentKey = key;
    const restore = saved?.state.doc.toString() === source ? saved : undefined;
    this.view.setState(restore?.state ?? EditorState.create({ doc: source, extensions: this.extensions }));
    (diagnosticsOpen ? openLintPanel : closeLintPanel)(this.view);
    this.view.dispatch({ effects: restore?.scroll ?? EditorView.scrollIntoView(0, { y: 'start' }) });
    // Opening the diagnostics panel focuses its list. Document switches must keep
    // focus with the picker, diagram, or editor that initiated them instead.
    if (editing) this.view.focus();
    else if (active === document.body) (document.activeElement as HTMLElement | null)?.blur();
    else if (active?.isConnected && (active instanceof HTMLElement || active instanceof SVGElement)) active.focus({ preventScroll: true });
  }
  forget(key: string) { this.documents.delete(key); if (this.currentKey === key) this.currentKey = ''; }
  undo() { return undo(this.view); }
  format(source: string) {
    const current = this.source;
    if (source === current) return false;
    // Keep unchanged text outside the transaction so selections there stay put.
    let from = 0;
    let oldEnd = current.length;
    let newEnd = source.length;
    while (from < oldEnd && from < newEnd && current[from] === source[from]) ++from;
    while (oldEnd > from && newEnd > from && current[oldEnd - 1] === source[newEnd - 1]) {
      --oldEnd;
      --newEnd;
    }
    this.view.dispatch({ changes: { from, to: oldEnd, insert: source.slice(from, newEnd) },
      userEvent: 'input.format', annotations: isolateHistory.of('full') });
    return true;
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
