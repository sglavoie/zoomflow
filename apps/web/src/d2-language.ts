import { HighlightStyle, StreamLanguage, syntaxHighlighting } from '@codemirror/language';
import { tags } from '@lezer/highlight';

/** Lightweight D2 highlighting. Compilation remains the authority for syntax errors. */
const language = StreamLanguage.define<{ block: string | null }>({
  languageData: { commentTokens: { line: '#' } },
  startState: () => ({ block: null }),
  token(stream, state) {
    if (state.block) {
      if (stream.match(state.block)) { state.block = null; return 'string'; }
      stream.skipToEnd();
      return 'string';
    }
    if (stream.eatSpace()) return null;
    if (stream.match(/#[0-9a-fA-F]{3,8}\b/)) return 'number';
    if (stream.match('#')) { stream.skipToEnd(); return 'comment'; }
    if (stream.match(/\|(?:md|markdown|latex|code)?\b/)) { state.block = '|'; return 'string'; }
    if (stream.match(/\.\.\.@[^\s;{}]+/)) return 'keyword';
    if (stream.match(/\$\{[^}]*\}/)) return 'variable';
    if (stream.match(/(?:https?:\/\/|mailto:)[^\s;,}]+/)) return 'url';
    if (stream.match(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/)) return 'string';
    if (stream.match(/(?:layers|scenarios|steps|classes|vars)\s*(?=:)/)) return 'keyword';
    if (stream.match(/[\w.-]+\s*(?=:)/)) return 'property';
    if (stream.match(/(?:-->|<--|<->|->|<-|--)/)) return 'operator';
    if (stream.match(/\b(?:true|false|near|direction|shape)\b/)) return 'keyword';
    if (stream.match(/\b\d+(?:\.\d+)?\b/)) return 'number';
    if (stream.match(/[{}:;|]/)) return 'punctuation';
    stream.next();
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
});

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

export const d2Language = [language, syntaxHighlighting(style)];
