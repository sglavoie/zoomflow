// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createCompiler } from '../src/compiler';
import { boardPicture } from '../src/board-picture';
import { setupExamplePictures } from '../src/example-pictures';

vi.mock('../src/compiler', () => ({ createCompiler: vi.fn() }));
vi.mock('../src/board-picture', () => ({ boardPicture: vi.fn(async (svg, dark) => `${svg}:${dark}`) }));
vi.mock('../src/examples', () => ({ examples: ['one', 'two', 'broken'].map(name => ({ name, source: `original:${name}` })) }));

const compile = vi.fn();
const render = vi.fn();
const disposeWorker = vi.fn();
let stop: () => void;
let picker: HTMLDetailsElement;
let buttons: Map<string, HTMLButtonElement>;
function busy(pane: string, value: boolean) {
  document.querySelector(`#${pane}`)!.setAttribute('aria-busy', String(value));
}
function ready() { document.querySelector('[data-part="preview-status"]')!.setAttribute('data-state', 'ready'); }
function gate<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('requestIdleCallback', vi.fn((callback: () => void) => setTimeout(callback, 0)));
  vi.stubGlobal('cancelIdleCallback', vi.fn((id: number) => clearTimeout(id)));
  document.documentElement.dataset.theme = 'light';
  document.body.innerHTML = '<div data-part="preview-status" data-state="loading"></div><div id="a" data-part="viewer" aria-busy="false"></div><div id="b" data-part="viewer" aria-busy="false"></div><details></details>';
  picker = document.querySelector('details')!;
  buttons = new Map(['one', 'two', 'broken'].map(name => {
    const button = document.createElement('button');
    button.innerHTML = '<span class="example-picture"><img alt="" hidden></span>';
    picker.append(button);
    return [name, button];
  }));
  compile.mockImplementation(async input => {
    if (input.inputPath === 'broken') throw new Error('Invalid source');
    return { diagram: input.fs[input.inputPath], renderOptions: {} };
  });
  render.mockImplementation(async diagram => diagram);
  vi.mocked(createCompiler).mockImplementation(() => ({
    ready: true, get: async () => ({ d2: { compile, render, dispose: disposeWorker }, fonts: {} }),
    dispose: disposeWorker, restart: vi.fn(),
  }) as unknown as ReturnType<typeof createCompiler>);
  stop = setupExamplePictures(picker, buttons).dispose;
});
afterEach(() => { stop(); vi.unstubAllGlobals(); });

it('waits for preview readiness, keeps failed slots and caches theme variants', async () => {
  picker.open = true;
  await new Promise(resolve => setTimeout(resolve, 10));
  expect(createCompiler).not.toHaveBeenCalled();
  ready();
  await vi.waitFor(() => expect(compile).toHaveBeenCalledTimes(3));
  expect(buttons.get('one')!.querySelector('img')!.getAttribute('src')).toBe('original:one:false');
  expect(buttons.get('broken')!.querySelector('img')!.hidden).toBe(true);
  document.documentElement.dataset.theme = 'dark';
  await vi.waitFor(() => expect(buttons.get('two')!.querySelector('img')!.getAttribute('src')).toBe('original:two:true'));
  document.documentElement.dataset.theme = 'light';
  await vi.waitFor(() => expect(buttons.get('two')!.querySelector('img')!.getAttribute('src')).toBe('original:two:false'));
  expect(compile).toHaveBeenCalledTimes(3);
  expect(boardPicture).toHaveBeenCalledTimes(4);
});

it('warms before opening only when the browser grants idle time', async () => {
  let run!: () => void;
  vi.mocked(window.requestIdleCallback).mockImplementation(callback => { run = () => callback({ didTimeout: false, timeRemaining: () => 50 }); return 42; });
  ready();
  await vi.waitFor(() => expect(window.requestIdleCallback).toHaveBeenCalledOnce());
  expect(picker.open).toBe(false);
  expect(createCompiler).not.toHaveBeenCalled();
  run();
  await vi.waitFor(() => expect(compile).toHaveBeenCalledOnce());
  expect(buttons.get('one')!.querySelector('img')!.getAttribute('src')).toBe('original:one:false');
});

it('cancels queued idle work on foreground input and disposal', async () => {
  vi.mocked(window.requestIdleCallback).mockReturnValue(42);
  ready();
  await vi.waitFor(() => expect(window.requestIdleCallback).toHaveBeenCalledOnce());
  busy('a', true);
  await vi.waitFor(() => expect(window.cancelIdleCallback).toHaveBeenCalledWith(42));
  expect(createCompiler).not.toHaveBeenCalled();
  busy('a', false);
  await vi.waitFor(() => expect(window.requestIdleCallback).toHaveBeenCalledTimes(2));
  stop();
  expect(window.cancelIdleCallback).toHaveBeenCalledTimes(2);
});

it('yields with a cancellable timer when idle callbacks are unavailable', async () => {
  vi.stubGlobal('requestIdleCallback', undefined);
  ready();
  await vi.waitFor(() => expect(compile).toHaveBeenCalledTimes(3));
  expect(picker.open).toBe(false);
});

it('cancels active work for either pane, waits through their debounces and discards late results', async () => {
  const held = gate<unknown>();
  compile.mockImplementationOnce(() => held.promise);
  picker.open = true; ready();
  await vi.waitFor(() => expect(compile).toHaveBeenCalledTimes(1));
  busy('b', true);
  await vi.waitFor(() => expect(disposeWorker).toHaveBeenCalledOnce());
  busy('a', true); busy('b', false);
  await new Promise(resolve => setTimeout(resolve, 10));
  expect(compile).toHaveBeenCalledTimes(1);
  held.resolve({ diagram: 'obsolete', renderOptions: {} });
  await new Promise(resolve => setTimeout(resolve, 10));
  expect(render).not.toHaveBeenCalled();
  busy('a', false);
  await vi.waitFor(() => expect(compile).toHaveBeenCalledTimes(4));
  expect(buttons.get('one')!.querySelector('img')!.getAttribute('src')).toBe('original:one:false');
});

it('a theme change replaces an in-flight picture without publishing its late old theme', async () => {
  const held = gate<string>();
  vi.mocked(boardPicture).mockImplementationOnce(() => held.promise);
  picker.open = true; ready();
  await vi.waitFor(() => expect(boardPicture).toHaveBeenCalledOnce());
  document.documentElement.dataset.theme = 'dark';
  await vi.waitFor(() => expect(buttons.get('one')!.querySelector('img')!.getAttribute('src')).toBe('original:one:true'));
  held.resolve('obsolete-light');
  await new Promise(resolve => setTimeout(resolve, 10));
  expect(buttons.get('one')!.querySelector('img')!.getAttribute('src')).toBe('original:one:true');
  expect(compile.mock.calls.filter(([input]) => input.inputPath === 'one')).toHaveLength(1);
});

it('restores a loaded picture when a theme switch returns before its replacement loads', async () => {
  ready();
  const picture = buttons.get('one')!.querySelector('img')!;
  await vi.waitFor(() => expect(picture.getAttribute('src')).toBe('original:one:false'));
  Object.defineProperty(picture, 'complete', { value: true });
  Object.defineProperty(picture, 'naturalWidth', { value: 72 });
  picture.dispatchEvent(new Event('load'));
  expect(picture.parentElement!.dataset.ready).toBe('true');
  const held = gate<string>();
  vi.mocked(boardPicture).mockImplementationOnce(() => held.promise);
  document.documentElement.dataset.theme = 'dark';
  await vi.waitFor(() => expect(picture.hidden).toBe(true));
  expect(picture.parentElement!.dataset.ready).toBeUndefined();
  document.documentElement.dataset.theme = 'light';
  await vi.waitFor(() => expect(picture.hidden).toBe(false));
  expect(picture.parentElement!.dataset.ready).toBe('true');
  held.resolve('obsolete-dark');
});
