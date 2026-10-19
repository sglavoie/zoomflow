import { basicSetup } from 'codemirror';
import { codeFolding } from '@codemirror/language';
import { EditorState, Prec, type Extension } from '@codemirror/state';
import { EditorView, keymap } from '@codemirror/view';
import { insertTab, isolateHistory, undo } from '@codemirror/commands';
import { lintGutter, setDiagnostics } from '@codemirror/lint';
import type { SourceRange } from '@zoomflow/core';
import { diagnosticLocation, type SourceDiagnostic } from './diagnostics';
import { d2Language } from './d2-language';
import { formatChanges } from './format-changes';

export class SourceEditor {
  readonly view: EditorView;
  private selectingShape = false;
  private readonly panel = document.createElement('section');
  private readonly diagnosticList = document.createElement('ul');
  private readonly extensions: Extension[];
  private currentKey = '';
  private readonly documents = new Map<string, { state: EditorState; scroll: ReturnType<EditorView['scrollSnapshot']> }>();
  constructor(parent: HTMLElement, source: string, changed: () => void, selected: () => void, format: () => void, reveal: () => void) {
    this.extensions = [
        basicSetup, d2Language, lintGutter(), EditorView.lineWrapping,
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
          '.cm-foldPlaceholder': { minHeight: '0', padding: '0 4px', lineHeight: 'inherit',
            fontFamily: 'inherit', fontSize: 'inherit', color: 'inherit', backgroundColor: '#8192a418' },
          '.cm-tooltip': { backgroundColor: 'Canvas', color: 'CanvasText' },
        }),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) changed();
          else if (update.selectionSet && !this.selectingShape) selected();
        }),
      ];
    this.view = new EditorView({ parent, state: EditorState.create({ doc: source, extensions: this.extensions }) });
    this.panel.className = 'cm-panel-lint source-diagnostics';
    this.panel.id = 'diagnostics-panel';
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
    this.panel.append(close, this.diagnosticList);
    parent.append(this.panel);
  }
  get source() { return this.view.state.doc.toString(); }
  get selection() { return this.view.state.selection.main; }
  open(key: string, source: string, reset = false) {
    const active = document.activeElement;
    const editing = this.view.hasFocus;
    if (this.currentKey) this.documents.set(this.currentKey, { state: this.view.state, scroll: this.view.scrollSnapshot() });
    const saved = reset ? undefined : this.documents.get(key);
    this.currentKey = key;
    const restore = saved?.state.doc.toString() === source ? saved : undefined;
    this.view.setState(restore?.state ?? EditorState.create({ doc: source, extensions: this.extensions }));
    this.view.dispatch({ effects: restore?.scroll ?? EditorView.scrollIntoView(0, { y: 'start' }) });
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
  format(source: string) {
    const current = this.source;
    if (source === current) return false;
    const changes = this.view.state.changes(formatChanges(current, source));
    this.view.dispatch({ changes, effects: this.view.scrollSnapshot().map(changes),
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
  diagnostics(items: SourceDiagnostic[], filename: string, documentName: string, canOpen: (item: SourceDiagnostic) => boolean, open: (item: SourceDiagnostic) => void) {
    this.view.dispatch(setDiagnostics(this.view.state, items.flatMap((item) =>
      item.filename === filename && item.range ? [{ ...item.range, severity: item.severity, message: item.message, source: item.source }] : [])));
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
  destroy() { this.view.destroy(); }
}
