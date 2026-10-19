import { countColumn } from '@codemirror/state';
import { Decoration, type DecorationSet, EditorView, ViewPlugin, type ViewUpdate } from '@codemirror/view';

/** Preserve the leading whitespace's visual column on wrapped lines. Only
 * decorate rendered lines so large documents don't slow down scrolling. */
export const hangingIndentation = ViewPlugin.fromClass(class {
  decorations: DecorationSet;
  constructor(view: EditorView) { this.decorations = this.build(view); }
  update(update: ViewUpdate) {
    if (update.docChanged || update.viewportChanged) this.decorations = this.build(update.view);
  }
  build(view: EditorView) {
    const lines = [];
    let last = -1;
    for (const { from, to } of view.visibleRanges) {
      for (let pos = from; pos <= to;) {
        const line = view.state.doc.lineAt(pos);
        if (line.from > last) {
          const whitespace = /^\s*/.exec(line.text)![0];
          const columns = countColumn(whitespace, view.state.tabSize);
          if (columns && whitespace.length < line.length) lines.push(Decoration.line({
            class: 'zf-indented-line',
            // Deep indentation must still leave room to read on a phone.
            attributes: { style: `--zf-line-indent: min(${columns}ch, 40%)` },
          }).range(line.from));
          last = line.from;
        }
        pos = line.to + 1;
      }
    }
    return Decoration.set(lines);
  }
}, { decorations: (plugin) => plugin.decorations });
