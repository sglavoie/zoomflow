// @vitest-environment happy-dom
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { expect, it } from 'vitest';
import { sameEntries, setupFileOpen } from '../src/file-open';

const handle = (id: string) => ({ id, isSameEntry: async (other: { id?: string }) => other.id === id }) as unknown as FileSystemFileHandle;

it('matches drafts by file handle and never reuses a handled draft for a file without one', async () => {
  const handles = new Map([['file:a', handle('a')], ['file:b', handle('b')]]);
  const picked = await sameEntries(handles, () => handle('a'));
  expect([picked('file:a'), picked('file:b'), picked('file:none')]).toEqual([true, false, undefined]);
  // A dropped file has no handle: drafts holding one may point at another file of the same name.
  const dropped = await sameEntries(handles, () => undefined);
  expect([dropped('file:a'), dropped('file:none')]).toEqual([false, undefined]);
});

it('opens a file dropped on the editor without also inserting its text there', async () => {
  document.body.innerHTML = '<p id="file-status"></p><input id="file" type="file"><input id="folder" type="file"><button id="open-folder"></button><button id="open-folder-picker"></button><button id="new-atlas-picker"></button><div id="pane-a"></div>';
  const root = document.querySelector<HTMLElement>('#pane-a')!;
  const view = new EditorView({ parent: root, state: EditorState.create({ doc: 'a: A\n' }) });
  // happy-dom has no layout, so drop at the start of the document.
  (view as unknown as { posAtCoords: () => number }).posAtCoords = () => 0;
  const opened: string[] = [];
  const pane = { replaceDocument: async (_source: string, name: string) => { opened.push(name); }, setActivity: () => {} };
  setupFileOpen({ picker: () => ({ rememberFile: () => 'file:new', refresh: () => {} }), activePane: () => pane, fileHandles: { ready: async () => {}, *[Symbol.iterator]() {}, set() {} }, directoryHandles: {}, paneRoots: { a: root, b: document.createElement('div') }, setActive: () => {} } as never);
  const transfer = new DataTransfer();
  transfer.items.add(new File(['dropped: D'], 'other.d2', { type: 'text/plain' }));
  const event = new DragEvent('drop', { bubbles: true, cancelable: true, clientX: 1, clientY: 1 });
  Object.defineProperty(event, 'dataTransfer', { value: transfer });
  view.contentDOM.dispatchEvent(event);
  await new Promise((resolve) => setTimeout(resolve, 50));
  expect(opened).toEqual(['other.d2']);
  expect(view.state.doc.toString()).toBe('a: A\n');
});
