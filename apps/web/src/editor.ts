import { basicSetup } from 'codemirror';
import { codeFolding } from '@codemirror/language';
import { EditorState, Prec, type Extension, type StateEffect } from '@codemirror/state';
import { EditorView, keymap } from '@codemirror/view';
import { insertTab, isolateHistory, redo, undo } from '@codemirror/commands';
import { lintGutter, setDiagnostics } from '@codemirror/lint';
import type { SourceRange } from '@zoomflow/core';
import { diagnosticLocation, type SourceDiagnostic } from './diagnostics';
import { d2Language } from './d2-language';
import { formatChanges } from './format-changes';
import { hangingIndentation } from './editor-indentation';
import { aiChanges } from './ai-changes';
import { aiHighlights, highlightAiLines } from './editor-ai-highlights';
import { boardFocus, focusBoard } from './editor-board-focus';
import { plural } from './text';

export type SourceEditorOptions = {
  source?: string;
  /** Page-unique ID for the diagnostics panel. */
  panelId: string;
  changed: () => void;
  selected: () => void;
  format: () => void;
  reveal: () => void;
  /** Accessible name of the editable source. */
  label?: string;
};

export class SourceEditor {
  readonly view: EditorView;
  private selectingShape = false;
  private readonly panel = document.createElement('section');
  private readonly diagnosticList = document.createElement('ul');
  private readonly extensions: Extension[];
  private currentKey = '';
  private updating = false;
  private diagnosticsRequest = 0;
  private readonly documents = new Map<string, { state: EditorState; scroll: ReturnType<EditorView['scrollSnapshot']> }>();
  constructor(parent: HTMLElement, { source = '', panelId, changed, selected, format, reveal, label = 'D2 source' }: SourceEditorOptions) {
    this.extensions = [
        basicSetup, d2Language, lintGutter(), EditorView.lineWrapping, hangingIndentation, aiHighlights, boardFocus,
        codeFolding({ placeholderDOM: (view, unfold) => {
          // Safari does not consistently dispatch clicks on non-editable spans.
          const button = document.createElement('button');
          button.type = 'button';
          button.className = 'cm-foldPlaceholder';
          button.textContent = '…';
          button.title = 'Unfold code';
          button.setAttribute('aria-label', 'Unfold code');
          button.tabIndex = -1;
          button.onmousedown = (event) => event.preventDefault();
          button.onclick = (event) => { unfold(event); view.focus(); };
          return button;
        } }),
        Prec.high(keymap.of([
          { key: 'Tab', run: insertTab },
          { key: 'Mod-Shift-m', run: () => { this.showDiagnostics(); return true; } },
          { key: 'Shift-Alt-f', run: () => { format(); return true; } },
          { key: 'Mod-Shift-Enter', run: () => { reveal(); return true; } },
        ])),
        EditorView.contentAttributes.of({ 'aria-label': label, 'aria-multiline': 'true' }),
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
          '.cm-gutters': { backgroundColor: 'transparent', color: 'var(--subtle)', borderColor: 'var(--border)' },
          '.cm-activeLine, .cm-activeLineGutter': { backgroundColor: 'var(--active-line)' },
          '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection': { backgroundColor: 'var(--selection)' },
          '.cm-cursor': { borderLeftColor: 'currentColor' },
          '.cm-foldPlaceholder': { minHeight: '0', padding: '0 4px', lineHeight: 'inherit',
            fontFamily: 'inherit', fontSize: 'inherit', color: 'inherit', backgroundColor: 'var(--active-line)' },
          '.cm-tooltip': { backgroundColor: 'Canvas', color: 'CanvasText' },
        }),
        EditorView.updateListener.of((update) => {
          this.updating = true;
          try {
            if (update.docChanged) changed();
            else if (update.selectionSet && !this.selectingShape) selected();
          } finally { this.updating = false; }
        }),
      ];
    this.view = new EditorView({ parent, state: EditorState.create({ doc: source, extensions: this.extensions }) });
    this.panel.className = 'cm-panel-lint source-diagnostics';
    this.panel.id = panelId;
    this.panel.hidden = true;
    this.panel.setAttribute('aria-label', 'Diagnostic list');
    const close = document.createElement('button');
    close.type = 'button';
    close.textContent = 'Close diagnostics';
    const dismiss = () => { this.panel.hidden = true; this.view.focus(); };
    close.addEventListener('click', dismiss);
    this.panel.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); dismiss(); }
      if (event.key === 'Backspace') event.stopPropagation();
    });
    this.diagnosticList.textContent = 'No diagnostics.';
    this.panel.append(close, this.diagnosticList);
    parent.append(this.panel);
  }
  get source() { return this.view.state.doc.toString(); }
  get selection() { return this.view.state.selection.main; }
  open(key: string, source: string, reset = false) {
    this.clearAiHighlights();
    const active = document.activeElement;
    const editing = this.view.hasFocus;
    if (this.currentKey) this.documents.set(this.currentKey, { state: this.view.state, scroll: this.view.scrollSnapshot() });
    const saved = reset ? undefined : this.documents.get(key);
    this.currentKey = key;
    const restore = saved?.state.doc.toString() === source ? saved : undefined;
    this.view.setState(restore?.state ?? EditorState.create({ doc: source, extensions: this.extensions }));
    this.view.dispatch({ effects: [restore?.scroll ?? EditorView.scrollIntoView(0, { y: 'start' }), highlightAiLines.of([])] });
    // Keep focus with the picker, diagram, or editor that initiated the switch.
    if (editing) this.view.focus();
    else if (active === document.body) (document.activeElement as HTMLElement | null)?.blur();
    else if (active?.isConnected && (active instanceof HTMLElement || active instanceof SVGElement)) active.focus({ preventScroll: true });
  }
  forget(key: string) { this.documents.delete(key); if (this.currentKey === key) this.currentKey = ''; }
  checkpoint(key: string) {
    const saved = key === this.currentKey ? { state: this.view.state, scroll: this.view.scrollSnapshot() } : this.documents.get(key);
    return () => {
      if (saved) this.documents.set(key, saved);
      if (this.currentKey === key) this.currentKey = '';
    };
  }
  copyDocument(key: string) {
    this.documents.set(this.currentKey, { state: this.view.state, scroll: this.view.scrollSnapshot() });
    this.currentKey = key;
  }
  undo() { return undo(this.view); }
  redo() { return redo(this.view); }
  /** Dim the source outside a board's block, and scroll to it when the board was just opened. */
  showBoard(block: SourceRange | undefined, scroll: boolean) {
    const effects: StateEffect<unknown>[] = [focusBoard.of(block ?? null)];
    if (block && scroll) effects.push(EditorView.scrollIntoView(Math.max(0, block.from - 1), { y: 'start', yMargin: 24 }));
    this.view.dispatch({ effects });
  }
  clearAiHighlights() {
    if (this.view.state.field(aiHighlights).size) this.view.dispatch({ effects: highlightAiLines.of([]) });
  }
  revealAiChange() {
    const first = this.view.state.field(aiHighlights).iter();
    if (!first.value) return;
    const line = this.view.state.doc.lineAt(first.from);
    this.view.dispatch({ selection: { anchor: line.from, head: line.to }, scrollIntoView: true });
    this.view.focus();
  }
  applyAi(source: string) {
    this.clearAiHighlights();
    const changes = this.view.state.changes(aiChanges(this.source, source));
    if (changes.empty) return '';
    const next = changes.apply(this.view.state.doc);
    const lines = new Set<number>();
    let deleted = false;
    changes.iterChanges((fromA, toA, fromB, toB) => {
      if (fromB === toB && fromA !== toA) deleted = true;
      const first = next.lineAt(fromB).number;
      const last = next.lineAt(Math.max(fromB, toB - 1)).number;
      for (let number = first; number <= last; number++) lines.add(next.line(number).from);
    });
    const scroll = this.view.scrollSnapshot().map(changes);
    this.view.dispatch({ changes, effects: [...(scroll ? [scroll] : []), highlightAiLines.of([...lines].sort((a, b) => a - b))],
      userEvent: 'input.ai', annotations: isolateHistory.of('full') });
    return `Changes at ${plural(lines.size, 'source line')}${deleted ? ' (including deletions)' : ''}.`;
  }
  format(source: string) {
    return this.replaceSource(source, 'input.format');
  }
  replaceSource(source: string, userEvent = 'input.builder') {
    const current = this.source;
    if (source === current) return false;
    const changes = this.view.state.changes(formatChanges(current, source));
    this.view.dispatch({ changes, effects: this.view.scrollSnapshot().map(changes),
      userEvent, annotations: isolateHistory.of('full') });
    return true;
  }
  select(range: SourceRange, focus: boolean) {
    this.selectingShape = true;
    try {
      this.view.dispatch({ selection: { anchor: range.from, head: range.to }, scrollIntoView: true });
      if (focus) this.view.focus();
    } finally { this.selectingShape = false; }
  }
  diagnostics(items: SourceDiagnostic[], filename: string, documentName: string, canOpen: (item: SourceDiagnostic) => boolean, open: (item: SourceDiagnostic) => void) {
    const request = ++this.diagnosticsRequest;
    const apply = () => {
      if (request !== this.diagnosticsRequest) return;
      this.view.dispatch(setDiagnostics(this.view.state, items.flatMap((item) =>
        item.filename === filename && item.range ? [{ ...item.range, severity: item.severity, message: item.message, source: item.source }] : [])));
    };
    // Edits clear diagnostics from the update listener; dispatch after that update, not inside it.
    if (this.updating) setTimeout(apply); else apply();
    this.diagnosticList.replaceChildren();
    for (const item of items) {
      const row = document.createElement('li');
      row.className = `cm-diagnostic cm-diagnostic-${item.severity}`;
      const location = diagnosticLocation(item, documentName);
      const text = `${item.severity === 'error' ? 'Error' : 'Warning'} · ${location} · ${item.message}${item.source ? ` (${item.source})` : ''}`;
      if (canOpen(item)) {
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = text;
        button.addEventListener('click', () => open(item));
        row.append(button);
      } else {
        row.textContent = `${text}${item.filename && item.line !== undefined ? ' · Source location unavailable in this document or project' : ''}`;
      }
      this.diagnosticList.append(row);
    }
    if (!items.length) this.diagnosticList.textContent = 'No diagnostics.';
  }
  showDiagnostics() {
    this.panel.hidden = false;
    (this.diagnosticList.querySelector('button') ?? this.panel.querySelector('button'))?.focus();
  }
  destroy() { ++this.diagnosticsRequest; this.view.destroy(); }
}
