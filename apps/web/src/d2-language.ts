import { HighlightStyle, StreamLanguage, StringStream, foldService, syntaxHighlighting, type StreamParser } from '@codemirror/language';
import type { Text } from '@codemirror/state';
import { highlightTree, tags } from '@lezer/highlight';

type State = { block: string | null; blockIndent: number; depth: number };
/** Shared lexical rules keep folding and indentation out of comments and labels. */
export const d2Parser: StreamParser<State> = {
  languageData: { commentTokens: { line: '#' }, indentOnInput: /^\s*\}/ },
  startState: () => ({ block: null, blockIndent: 0, depth: 0 }),
  indent(state, textAfter, context) {
    if (state.block) return state.blockIndent + (textAfter.trimStart().startsWith(state.block) ? 0 : context.unit);
    return Math.max(0, state.depth - (textAfter.trimStart().startsWith('}') ? 1 : 0)) * context.unit;
  },
  token(stream, state) {
    if (state.block) {
      // A closing delimiter may be indented or appear after text on the same line.
      while (!stream.eol()) {
        if (stream.match(state.block)) { state.block = null; break; }
        if (stream.next() === '\\') stream.next();
      }
      return 'string';
    }
    if (stream.eatSpace()) return null;
    const value = /:\s*$/.test(stream.string.slice(0, stream.pos));
    if (value && stream.match(/#[0-9a-fA-F]{3,8}\b/)) return 'number';
    if (stream.match('#')) { stream.skipToEnd(); return 'comment'; }
    // Only a value can open a multiline string; a pipe later in an unquoted label is text.
    // Backticks after the opening pipes, as in |`ts, close only with the same backticks before the pipes.
    const block = value && stream.match(/(\|+)(`*)[a-zA-Z0-9_-]*/);
    if (Array.isArray(block)) { state.block = block[2] + block[1]; state.blockIndent = stream.indentation(); return 'string'; }
    if (stream.match(/\.\.\.@[^\s;{}]+/)) return 'keyword';
    if (stream.match(/\$\{[^}]*\}/)) return 'variable';
    if (stream.match(/(?:https?:\/\/|mailto:)[^\s;,}]+/)) return 'url';
    if (stream.match(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/)) return 'string';
    if (stream.match(/(?:layers|scenarios|steps|classes|vars)\s*(?=:)/)) return 'keyword';
    if (stream.match(/[\w.-]+\s*(?=:)/)) return 'property';
    if (stream.match(/(?:-->|<--|<->|->|<-|--)/)) return 'operator';
    if (stream.match(/\b(?:true|false|near|direction|shape)\b/)) return 'keyword';
    if (stream.match(/\b\d+(?:\.\d+)?\b/)) return 'number';
    if (stream.match('{')) { state.depth++; return 'punctuation'; }
    if (stream.match('}')) { state.depth = Math.max(0, state.depth - 1); return 'punctuation'; }
    if (stream.match(/[:;|]/)) return 'punctuation';
    // Escaped braces and pipes in unquoted labels do not change structure.
    if (stream.next() === '\\') stream.next();
    return null;
  },
  tokenTable: {
    comment: tags.comment,
    string: tags.string,
    keyword: tags.keyword,
    property: tags.propertyName,
    variable: tags.variableName,
    url: tags.url,
    number: tags.number,
    operator: tags.operator,
    punctuation: tags.punctuation,
  },
};

const language = StreamLanguage.define(d2Parser);

const style = HighlightStyle.define([
  { tag: tags.comment, class: 'zf-token-comment' },
  { tag: tags.string, class: 'zf-token-string' },
  { tag: tags.keyword, class: 'zf-token-keyword' },
  { tag: tags.propertyName, class: 'zf-token-property' },
  { tag: tags.variableName, class: 'zf-token-variable' },
  { tag: tags.url, class: 'zf-token-url' },
  { tag: tags.number, class: 'zf-token-number' },
  { tag: tags.operator, class: 'zf-token-operator' },
  { tag: tags.punctuation, class: 'zf-token-punctuation' },
]);

type Fold = { from: number; to: number };
const folds = new WeakMap<Text, Map<number, Fold>>();
const folding = foldService.of((editor, lineStart) => {
  let ranges = folds.get(editor.doc);
  if (!ranges) {
    ranges = new Map();
    const state = d2Parser.startState!(2);
    const stack: { from: number; line: number }[] = [];
    for (let number = 1; number <= editor.doc.lines; number++) {
      const line = editor.doc.line(number);
      const stream = new StringStream(line.text, editor.tabSize, 2);
      while (!stream.eol()) {
        stream.start = stream.pos;
        const token = d2Parser.token(stream, state);
        if (token !== 'punctuation') continue;
        if (stream.current() === '{') stack.push({ from: line.from + stream.pos, line: line.from });
        else if (stream.current() === '}') {
          const opening = stack.pop();
          if (opening && opening.line < line.from) {
            const previous = ranges.get(opening.line);
            if (!previous || opening.from < previous.from) ranges.set(opening.line, { from: opening.from, to: line.from + stream.start });
          }
        }
      }
    }
    folds.set(editor.doc, ranges);
  }
  return ranges.get(lineStart) ?? null;
});

export const d2Language = [language, syntaxHighlighting(style), folding];

/** Reference snippets use exactly the editor's parser and token classes. */
export function d2HighlightRanges(source: string) {
  const ranges: { from: number; to: number; className: string }[] = [];
  highlightTree(language.parser.parse(source), style, (from, to, className) => ranges.push({ from, to, className }));
  return ranges;
}
