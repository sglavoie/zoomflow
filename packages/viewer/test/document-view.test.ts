import { expect, it } from 'vitest';
import { parseDocumentView, serializeDocumentView } from '../src/document-view';

it('round trips custom layers and explicit hidden choices while omitting the default view', () => {
  expect(serializeDocumentView({ hidden: [['root', []]], layers: { all: false, expanded: [] } })).toBeUndefined();
  const view = { hidden: [['root', ['private']]] as [string, string[]][],
    layers: { root: 'root', expanded: ['root.layers.A'], all: false, depth: 1 } };
  expect(parseDocumentView(serializeDocumentView(view))).toEqual(view);
});

it('ignores damaged and unknown versions and salvages independently valid view settings', () => {
  for (const value of [undefined, '', '{', 'null', '[]', '{"version":2,"hidden":[]}']) expect(parseDocumentView(value)).toEqual({});
  const layers = { root: 'root', expanded: ['root.layers.A'], all: true };
  expect(parseDocumentView(JSON.stringify({ version: 1, hidden: [['root', [42]]], layers }))).toEqual({ layers });
  for (const depth of [-1, 1.5, '1']) {
    expect(parseDocumentView(JSON.stringify({ version: 1, hidden: [['root', ['a']]], layers: { ...layers, depth } })))
      .toEqual({ hidden: [['root', ['a']]] });
  }
});
