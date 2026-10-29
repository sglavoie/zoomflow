// @vitest-environment happy-dom
import { expect, it, vi } from 'vitest';
import { setupDocumentActions } from '../src/document-actions';

// happy-dom has no modal dialog implementation.
HTMLDialogElement.prototype.showModal ??= function () { this.open = true; };
HTMLDialogElement.prototype.close ??= function (value = '') {
  this.returnValue = value;
  this.open = false;
  this.dispatchEvent(new Event('close'));
};

it('asks simultaneous confirmations in order and settles each answer separately', async () => {
  document.body.innerHTML = '';
  const returnFocus = vi.fn();
  const firstFocus = vi.fn();
  const actions = setupDocumentActions(returnFocus);
  const first = vi.fn(), second = vi.fn();
  const firstAnswer = actions.confirm('Overwrite first.d2?', 'First file changed.', 'Overwrite first', firstFocus).then(first);
  const secondAnswer = actions.confirm('Overwrite second.d2?', 'Second file changed.', 'Overwrite second').then(second);
  const dialog = document.querySelector('dialog')!;
  await vi.waitFor(() => expect(dialog.querySelector('h2')!.textContent).toBe('Overwrite first.d2?'));
  expect(second).not.toHaveBeenCalled();
  dialog.querySelector<HTMLButtonElement>('.button-primary')!.click();
  await firstAnswer;
  expect(first).toHaveBeenCalledExactlyOnceWith(true);
  expect(firstFocus).toHaveBeenCalledOnce();
  await vi.waitFor(() => expect(dialog.querySelector('h2')!.textContent).toBe('Overwrite second.d2?'));
  expect(dialog.open).toBe(true);
  expect(second).not.toHaveBeenCalled();
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', cancelable: true }));
  await secondAnswer;
  expect(second).toHaveBeenCalledExactlyOnceWith(false);
  expect(returnFocus).toHaveBeenCalledOnce();
  expect(dialog.open).toBe(false);
});
