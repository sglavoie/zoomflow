// @vitest-environment happy-dom
import { afterEach, expect, it } from 'vitest';
import { fileLinkDialog, type FileBoard } from '../src/file-link-dialog';

// happy-dom has no Option constructor.
globalThis.Option ??= new Proxy(HTMLOptionElement, {
  construct: (_, [text = '', value = '', defaultSelected = false, selected = false]) =>
    Object.assign(document.createElement('option'), { textContent: text, value, defaultSelected, selected }),
});

const submit = () => document.querySelector<HTMLFormElement>('#file-link-dialog form')!.requestSubmit();
const settle = () => new Promise(done => setTimeout(done, 0));

afterEach(async () => {
  const dialog = document.querySelector<HTMLDialogElement>('#file-link-dialog');
  if (dialog?.open) dialog.close();
  await settle();
});

it('keeps the link’s board when Change link is submitted before its boards load', async () => {
  let release!: (boards: FileBoard[]) => void;
  const choice = fileLinkDialog().link({ files: ['a.d2', 'b.d2'], current: { path: 'b.d2', hash: '#/Viewer' }, shape: 'X',
    boards: () => new Promise(done => { release = done; }) });
  submit();
  await expect(choice).resolves.toEqual({ path: 'b.d2', hash: '#/Viewer' });
  release([{ hash: '#/Viewer', label: 'Viewer' }]);
});

it('keeps the link’s board when the linked file’s boards cannot be read', async () => {
  const choice = fileLinkDialog().link({ files: ['b.d2'], current: { path: 'b.d2', hash: '#/Viewer' }, shape: 'X',
    boards: () => Promise.reject(new Error('compile error')) });
  await settle();
  expect(document.querySelector('#file-link-status')!.textContent).toContain('the board it opened before');
  submit();
  await expect(choice).resolves.toEqual({ path: 'b.d2', hash: '#/Viewer' });
});

it('selects the listed board an unencoded authored route names, once, and a new file starts at its home board', async () => {
  const choice = fileLinkDialog().link({ files: ['a.d2', 'b.d2'], current: { path: 'b.d2', hash: '#/My Board' }, shape: 'X',
    boards: async path => path === 'b.d2' ? [{ hash: '#/My%20Board', label: 'My Board' }, { hash: '#/Other', label: 'Other' }] : [] });
  await settle();
  const board = document.querySelector<HTMLSelectElement>('#file-link-board')!;
  expect([...board.options].map(option => option.value)).toEqual(['', '#/My%20Board', '#/Other']);
  expect(board.value).toBe('#/My%20Board');
  const file = document.querySelector<HTMLSelectElement>('#file-link-file')!;
  file.value = 'a.d2';
  file.dispatchEvent(new Event('change'));
  await settle();
  expect(board.value).toBe('');
  submit();
  await expect(choice).resolves.toEqual({ path: 'a.d2', hash: '' });
});

it('does not submit a link without a file to open', async () => {
  void fileLinkDialog().link({ files: [], shape: 'X', boards: async () => [] });
  await settle();
  expect(document.querySelector<HTMLSelectElement>('#file-link-file')!.checkValidity()).toBe(false);
});

it('matches authored routes with percent signs, @ names and trailing slashes to their compiled boards', async () => {
  for (const [authored, compiled] of [['#/50%', '#/50%25'], ['#/@home', '#/%40home'], ['#/Plan/', '#/Plan']]) {
    const choice = fileLinkDialog().link({ files: ['b.d2'], current: { path: 'b.d2', hash: authored }, shape: 'X',
      boards: async () => [{ hash: compiled, label: 'Target' }] });
    await settle();
    const board = document.querySelector<HTMLSelectElement>('#file-link-board')!;
    expect([...board.options].map(option => option.value)).toEqual(['', compiled]);
    expect(board.value).toBe(compiled);
    submit();
    await expect(choice).resolves.toEqual({ path: 'b.d2', hash: compiled });
    await settle();
  }
});
