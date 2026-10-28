import { afterAll, beforeAll, expect, it } from 'vitest';
import { D2 } from '@d2lang/d2';
import { EditorState } from '@codemirror/state';
import { ensureSyntaxTree, foldable, getIndentation, StringStream } from '@codemirror/language';
import { d2Language, d2Parser } from '../src/d2-language';

let d2: D2;
beforeAll(() => { d2 = new D2(); });
afterAll(async () => { await d2.dispose(); });
const examples = [
  `a: Start {link: layers.detail}\nlayers: {\n  detail: {\n    note: |md\n      **Braces {here} are text**\n    |\n    done: End\n  }\n}`,
  `a: Root\nscenarios: {\n  alternate: {\n    b: Alternate\n  }\n}\nsteps: {\n  first: {\n    c: First step\n  }\n}`,
  `note: ||md\n  A pipe | in text, and {braces}\n||\na: After`,
  `a -> b: Yes | No\nlayers: {\n  detail: {\n    c: x | y\n  }\n}`,
  'code: |`ts\n  const x = a || b; if (x) { y\n`|\nlayers: {\n  detail: {\n    c\n  }\n}',
  'path: |md\n  C:\\ path\\|\nlayers: {\n  detail: {\n    c\n  }\n}',
];

it.each(examples)('folds real D2 structures without interpreting label text: %s', async (source) => {
  const compiled = await d2.compile(source, { layout: 'elk' });
  expect(await d2.render(compiled.diagram, compiled.renderOptions)).toContain('<svg');
  const editor = EditorState.create({ doc: source, extensions: d2Language });
  ensureSyntaxTree(editor, source.length, 1000);
  for (let i = 1; i <= editor.doc.lines; i++) {
    const line = editor.doc.line(i);
    const fold = foldable(editor, line.from, line.to);
    if (/^\s*(layers|detail|scenarios|alternate|steps|first): \{$/.test(line.text)) {
      expect(fold).not.toBeNull();
      expect(source[fold!.from - 1]).toBe('{');
      expect(source[fold!.to]).toBe('}');
    } else expect(fold).toBeNull();
  }
});

it('indents nested maps and dedents closing braces without counting braces in labels or comments', () => {
  const source = 'layers: {\n  detail: {\n    note: "{quoted}" # }\n    next\n  }\n}';
  const editor = EditorState.create({ doc: source, extensions: d2Language });
  ensureSyntaxTree(editor, source.length, 1000);
  expect(getIndentation(editor, editor.doc.line(2).from)).toBe(2);
  expect(getIndentation(editor, editor.doc.line(4).from)).toBe(4);
  expect(getIndentation(editor, editor.doc.line(5).from)).toBe(2);
  expect(getIndentation(editor, editor.doc.line(6).from)).toBe(0);
});

it('ends a backtick multiline string only at its own delimiter, so pipes and braces inside it are text', () => {
  const source = 'code: |`ts\n  const x = a || b; if (x) { y\n`|\nlayers: {\n  c\n}';
  const editor = EditorState.create({ doc: source, extensions: d2Language });
  ensureSyntaxTree(editor, source.length, 1000);
  expect(getIndentation(editor, editor.doc.line(4).from)).toBe(0);
  expect(getIndentation(editor, editor.doc.line(5).from)).toBe(2);
  expect(getIndentation(editor, editor.doc.line(6).from)).toBe(0);
});

it('ends indented and inline multiline strings so following D2 regains highlighting', () => {
  const state = d2Parser.startState!(2);
  const tokens: { text: string; style: string | null }[] = [];
  for (const line of ['note: |md', '  # Heading {text}', '  |', 'a: Done', 'inline: |md text |', 'b: Next']) {
    const stream = new StringStream(line, 4, 2);
    while (!stream.eol()) {
      stream.start = stream.pos;
      const style = d2Parser.token(stream, state);
      tokens.push({ text: stream.current(), style });
    }
  }
  expect(tokens).toContainEqual({ text: '  # Heading {text}', style: 'string' });
  expect(tokens).toContainEqual({ text: 'a', style: 'property' });
  expect(tokens).toContainEqual({ text: 'b', style: 'property' });
  expect(state.block).toBeNull();
  expect(state.depth).toBe(0);
});

it('ends a multiline string at a delimiter after a backslash, since D2 has no escapes in it', () => {
  const state = d2Parser.startState!(2);
  const tokens: { text: string; style: string | null }[] = [];
  for (const line of ['a: |md C:\\|', 'b: {', '  c', '}']) {
    const stream = new StringStream(line, 4, 2);
    while (!stream.eol()) {
      stream.start = stream.pos;
      const style = d2Parser.token(stream, state);
      tokens.push({ text: stream.current(), style });
    }
  }
  expect(tokens).toContainEqual({ text: ' C:\\|', style: 'string' });
  expect(tokens).toContainEqual({ text: 'b', style: 'property' });
  expect(state.block).toBeNull();
  expect(state.depth).toBe(0);
});

it('ends a single-quoted string at a quote after a backslash, as D2 does, and reads a doubled quote as a quote', () => {
  const state = d2Parser.startState!(2);
  const tokens: { text: string; style: string | null }[] = [];
  for (const line of ["a: 'C:\\' {", "  b: 'it''s'", '}']) {
    const stream = new StringStream(line, 4, 2);
    while (!stream.eol()) {
      stream.start = stream.pos;
      const style = d2Parser.token(stream, state);
      tokens.push({ text: stream.current(), style });
    }
  }
  expect(tokens).toContainEqual({ text: "'C:\\'", style: 'string' });
  expect(tokens).toContainEqual({ text: "'it''s'", style: 'string' });
  expect(state.depth).toBe(0);
});

it('reads a pipe inside an unquoted label as text, not the start of a multiline string', () => {
  const state = d2Parser.startState!(2);
  const tokens: { text: string; style: string | null }[] = [];
  for (const line of ['a -> b: Yes | No', 'c: x | y', 'd: Next']) {
    const stream = new StringStream(line, 4, 2);
    while (!stream.eol()) {
      stream.start = stream.pos;
      const style = d2Parser.token(stream, state);
      tokens.push({ text: stream.current(), style });
    }
  }
  expect(tokens).toContainEqual({ text: 'd', style: 'property' });
  expect(tokens.some(token => token.style === 'string')).toBe(false);
  expect(state.block).toBeNull();
});

it('reads quotes inside unquoted labels as text, so braces after them still nest', async () => {
  const source = "team: {\n  ceo: Bob's office {tooltip: Al's}\n  \"quoted\" -> 'single'\n}";
  const compiled = await d2.compile(source, { layout: 'elk' });
  expect(compiled.diagram.shapes.find(shape => shape.id === 'team.ceo')).toMatchObject({ label: "Bob's office", tooltip: "Al's" });
  const editor = EditorState.create({ doc: source, extensions: d2Language });
  ensureSyntaxTree(editor, source.length, 1000);
  expect(getIndentation(editor, editor.doc.line(3).from)).toBe(2);
  const fold = foldable(editor, editor.doc.line(1).from, editor.doc.line(1).to);
  expect(fold?.to).toBe(source.length - 1);
  const state = d2Parser.startState!(2);
  const strings: string[] = [];
  for (const line of source.split('\n')) {
    const stream = new StringStream(line, 4, 2);
    while (!stream.eol()) {
      stream.start = stream.pos;
      if (d2Parser.token(stream, state) === 'string') strings.push(stream.current());
    }
  }
  expect(strings).toEqual(['"quoted"', "'single'"]);
});
