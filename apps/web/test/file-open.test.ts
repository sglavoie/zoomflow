// @vitest-environment happy-dom
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { expect, it, vi } from 'vitest';
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

it('opens a file with CRLF line breaks as the editor will show it, so it is not unsaved before any edit', async () => {
  document.body.innerHTML = '<p id="file-status"></p><input id="file" type="file"><input id="folder" type="file"><button id="open-folder"></button><button id="open-folder-picker"></button><button id="new-atlas-picker"></button><div id="pane-a"></div>';
  const root = document.querySelector<HTMLElement>('#pane-a')!;
  const remembered: string[][] = [];
  const opened: string[] = [];
  const pane = { replaceDocument: async (source: string) => { opened.push(source); }, setActivity: () => {} };
  setupFileOpen({ picker: () => ({ rememberFile: (_name: string, source: string, baseline: string) => { remembered.push([source, baseline]); return 'file:new'; }, refresh: () => {} }), activePane: () => pane, fileHandles: { ready: async () => {}, *[Symbol.iterator]() {}, set() {} }, directoryHandles: {}, paneRoots: { a: root, b: document.createElement('div') }, setActive: () => {} } as never);
  const transfer = new DataTransfer();
  transfer.items.add(new File(['a -> b\r\nb -> c\r\n'], 'windows.d2', { type: 'text/plain' }));
  const event = new DragEvent('drop', { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'dataTransfer', { value: transfer });
  root.dispatchEvent(event);
  await new Promise((resolve) => setTimeout(resolve, 50));
  // The editor reads CRLF back as LF; a CRLF baseline would differ from it without any edit.
  expect(remembered).toEqual([['a -> b\nb -> c\n', 'a -> b\nb -> c\n']]);
  expect(opened).toEqual(['a -> b\nb -> c\n']);
});

it.each(['file', 'folder'] as const)('keeps a slow %s open in its original pane when focus changes', async (kind) => {
  document.body.innerHTML = '<p id="file-status"></p><input id="file" type="file"><input id="folder" type="file"><button id="open-folder"></button><button id="open-folder-picker"></button><button id="new-atlas-picker"></button><div id="pane-a"></div>';
  const root = document.querySelector<HTMLElement>('#pane-a')!;
  const a = { id: 'a', replaceDocument: vi.fn(async () => {}), setActivity: vi.fn() };
  const b = { id: 'b', replaceDocument: vi.fn(async () => {}), setActivity: vi.fn() };
  let active = a;
  const rememberFile = vi.fn(() => 'file:new');
  const rememberFolder = vi.fn(() => ({ key: 'project:new:index.d2', name: 'index.d2', source: 'a', keys: {}, projectId: 'new' }));
  setupFileOpen({ picker: () => ({ rememberFile, rememberFolder, refresh: () => {} }), activePane: () => active,
    fileHandles: { ready: async () => {}, *[Symbol.iterator]() {}, set() {} }, directoryHandles: {},
    paneRoots: { a: root, b: document.createElement('div') }, setActive: () => {} } as never);
  let finish!: (text: string) => void;
  const file = new File(['a'], 'index.d2');
  Object.defineProperty(file, 'webkitRelativePath', { value: 'notes/index.d2' });
  file.text = () => new Promise(resolve => { finish = resolve; });
  const input = document.querySelector<HTMLInputElement>(`#${kind}`)!;
  Object.defineProperty(input, 'files', { value: [file] });
  input.dispatchEvent(new Event('change'));
  await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
  active = b;
  finish('a');
  await vi.waitFor(() => expect(a.replaceDocument).toHaveBeenCalled());
  expect(b.replaceDocument).not.toHaveBeenCalled();
  expect((kind === 'file' ? rememberFile : rememberFolder).mock.calls[0].at(-1)).toBe('a');
});

it.each([
  ['file', 'file'], ['file', 'folder'], ['folder', 'file'], ['folder', 'folder'],
] as const)('keeps the newer %s/%s selection when the older read finishes last', async (older, newer) => {
  document.body.innerHTML = '<p id="file-status" hidden></p><input id="file" type="file"><input id="folder" type="file"><button id="open-folder"></button><button id="open-folder-picker"></button><button id="new-atlas-picker"></button><div id="pane-a"></div>';
  const pane = { id: 'a', documentOpens: 0, replaceDocument: vi.fn(async () => { pane.documentOpens++; }), setActivity: vi.fn() };
  const rememberFile = vi.fn(() => 'file:new');
  const rememberFolder = vi.fn(() => ({ key: 'project:new:latest.d2', name: 'latest.d2', source: 'Latest', keys: {}, projectId: 'new' }));
  setupFileOpen({ picker: () => ({ rememberFile, rememberFolder, refresh() {} }), activePane: () => pane,
    fileHandles: { ready: async () => {}, *[Symbol.iterator]() {}, set() {} }, directoryHandles: {},
    paneRoots: { a: document.querySelector('#pane-a'), b: document.createElement('div') }, setActive() {} } as never);
  const select = (kind: 'file' | 'folder', file: File) => {
    Object.defineProperty(file, 'webkitRelativePath', { value: `notes/${file.name}` });
    const input = document.querySelector<HTMLInputElement>(`#${kind}`)!;
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    Object.defineProperty(input, 'value', { value: 'chosen', writable: true, configurable: true });
    input.dispatchEvent(new Event('change'));
  };
  let finish!: (text: string) => void;
  const slow = new File(['Old'], 'old.d2');
  slow.text = () => new Promise(resolve => { finish = resolve; });
  select(older, slow);
  await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
  select(newer, new File(['Latest'], 'latest.d2'));
  await vi.waitFor(() => expect(pane.replaceDocument).toHaveBeenCalledWith('Latest', 'latest.d2', expect.any(String)));
  finish('Old');
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(pane.replaceDocument).toHaveBeenCalledOnce();
  expect(rememberFile.mock.calls.length + rememberFolder.mock.calls.length).toBe(1);
  expect(document.querySelector('#file-status')!.textContent).toBe('');
  expect(document.querySelector<HTMLInputElement>(`#${older}`)!.value).toBe('');
});

it.each(['success', 'error'] as const)('ignores an outstanding file read completing with %s after the pane changes documents', async (result) => {
  document.body.innerHTML = '<p id="file-status" hidden></p><input id="file" type="file"><input id="folder" type="file"><button id="open-folder"></button><button id="open-folder-picker"></button><button id="new-atlas-picker"></button><div id="pane-a"></div>';
  const pane = { id: 'a', documentOpens: 0, replaceDocument: vi.fn(async () => {}), setActivity: vi.fn() };
  const rememberFile = vi.fn(() => 'file:new');
  setupFileOpen({ picker: () => ({ rememberFile, refresh() {} }), activePane: () => pane,
    fileHandles: { ready: async () => {}, *[Symbol.iterator]() {}, set() {} }, directoryHandles: {},
    paneRoots: { a: document.querySelector('#pane-a'), b: document.createElement('div') }, setActive() {} } as never);
  let finish!: (text: string) => void;
  let fail!: (error: Error) => void;
  const file = new File(['Old'], 'old.d2');
  file.text = () => new Promise((resolve, reject) => { finish = resolve; fail = reject; });
  const input = document.querySelector<HTMLInputElement>('#file')!;
  Object.defineProperty(input, 'files', { value: [file] });
  input.dispatchEvent(new Event('change'));
  await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
  pane.documentOpens++;
  if (result === 'error') fail(new Error('Old read failed'));
  else finish('Old');
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(rememberFile).not.toHaveBeenCalled();
  expect(pane.replaceDocument).not.toHaveBeenCalled();
  expect(pane.setActivity).not.toHaveBeenCalled();
  expect(document.querySelector('#file-status')!.textContent).toBe('');
});
