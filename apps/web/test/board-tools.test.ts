// @vitest-environment happy-dom
import { expect, it } from 'vitest';
import { boardKey, type Board } from '@zoomflow/core';
import { boardSites } from '../src/board-model';
import { setupBoardTools } from '../src/board-tools';
import { plainLook } from '../src/flow-model';
import { boardTopics, mindMapSource, parseOutline, readMindMap } from '../src/mind-map-model';
import { paneScope } from '../src/pane-scope';

/** The boards of a mind map whose detail boards are one level deep, as D2 indexes them. */
function index(source: string) {
  const map = readMindMap(source)!;
  const shapes = (topics: ReturnType<typeof boardTopics>) =>
    topics.map(item => ({ id: item.id, label: item.topic.label, link: item.board ? `root.layers.${boardKey(item.board)}` : '' }));
  const main = boardTopics(map);
  const boards = new Map<string, Board>([['root', { id: 'root', name: 'Root', kind: 'root', diagram: { shapes: shapes(main) } } as unknown as Board]]);
  for (const item of main) {
    if (!item.board) continue;
    const id = `root.layers.${boardKey(item.board)}`;
    boards.set(id, { id, name: item.board, kind: 'layers', parent: 'root', diagram: { shapes: shapes(boardTopics(map, item.topic)) } } as unknown as Board);
  }
  return boards;
}

it('follows each of several board-moving edits on the diagram back through undo and forward through redo', async () => {
  document.body.innerHTML = '<div id="pane"><div data-part="viewer"><div id="stage" tabindex="0"></div></div></div>';
  const stage = document.getElementById('stage')!;
  let boards = new Map<string, Board>();
  let source = mindMapSource({ direction: 'right', split: 1, look: plainLook(), root: parseOutline('Root\n  A\n    a1')! });
  const viewer = { stage, currentBoard: undefined as Board | undefined,
    async navigate(id: string) { viewer.currentBoard = boards.get(id); } };
  const tools = setupBoardTools(paneScope('a', document.getElementById('pane')!), viewer as never, {
    builders: {} as never, source: () => source, update: next => { source = next; tools.invalidate(); },
    selectSource: () => {}, inSource: () => true, status: () => {}, undo: () => {}, redo: () => {},
  });
  /** Compile and show the source; like the viewer, a board that is gone falls back to the main board. */
  async function settle() {
    boards = index(source);
    tools.compiled(source, boardSites(source, new Map([['root', { from: 0, to: source.length }]]), boards), boards);
    viewer.currentBoard = boards.get(viewer.currentBoard?.id ?? 'root') ?? boards.get('root');
    await tools.settled();
    stage.innerHTML = viewer.currentBoard!.diagram.shapes.map(shape => `<g data-shape-id="${shape.id}" tabindex="0"></g>`).join('');
  }
  async function renameCentre(label: string) {
    stage.querySelector('[data-shape-id="n"]')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'F2', bubbles: true }));
    const input = document.querySelector<HTMLInputElement>('.canvas-rename')!;
    input.value = label;
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await settle();
  }
  async function restore(text: string) { source = text; tools.invalidate(); await settle(); }
  await settle();
  viewer.currentBoard = boards.get('root.layers.A');
  await settle();
  const sources = [source];
  for (const label of ['B', 'C']) { await renameCentre(label); sources.push(source); }
  expect(viewer.currentBoard!.id).toBe('root.layers.C');
  for (const [text, board] of [[sources[1], 'B'], [sources[0], 'A'], [sources[1], 'B'], [sources[2], 'C']]) {
    await restore(text);
    expect(viewer.currentBoard!.id).toBe(`root.layers.${board}`);
  }
});
