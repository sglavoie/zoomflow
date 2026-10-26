import { StateEffect, StateField } from '@codemirror/state';
import { Decoration, EditorView } from '@codemirror/view';

/** The block of the board on view, or null for the root board, whose block is the whole document. */
export const focusBoard = StateEffect.define<{ from: number; to: number } | null>();
const outside = Decoration.line({ class: 'zf-outside-board' });
/** Dims the lines outside the block of the board on view, so its source stands out. */
export const boardFocus = StateField.define({
  create: () => Decoration.none,
  update(value, transaction) {
    // Edits move blocks; the next compile focuses the board again.
    if (transaction.docChanged) value = Decoration.none;
    for (const effect of transaction.effects) {
      if (!effect.is(focusBoard)) continue;
      const block = effect.value;
      const { doc } = transaction.state;
      const lines = [];
      if (block) {
        // The lines with the block's braces belong to it.
        const first = doc.lineAt(Math.max(0, block.from - 1)).number;
        const last = doc.lineAt(Math.min(doc.length, block.to + 1)).number;
        for (let number = 1; number <= doc.lines; number++) {
          if (number < first || number > last) lines.push(outside.range(doc.line(number).from));
        }
      }
      value = Decoration.set(lines);
    }
    return value;
  },
  provide: (field) => EditorView.decorations.from(field),
});
