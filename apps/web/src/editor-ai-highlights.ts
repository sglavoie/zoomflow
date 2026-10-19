import { StateEffect, StateField } from '@codemirror/state';
import { Decoration, EditorView } from '@codemirror/view';

export const highlightAiLines = StateEffect.define<readonly number[]>();
export const aiHighlights = StateField.define({
  create: () => Decoration.none,
  update(value, transaction) {
    if (transaction.docChanged) value = Decoration.none;
    for (const effect of transaction.effects) {
      if (effect.is(highlightAiLines)) value = Decoration.set(effect.value.map((from) =>
        Decoration.line({ class: 'zf-ai-changed', attributes: { title: 'Changed by AI' } }).range(from)));
    }
    return value;
  },
  provide: (field) => EditorView.decorations.from(field),
});
