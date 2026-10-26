/** Modal behaviour shared by the form builders. `discard` resolves whether closing may proceed,
 * asking first when that would discard changes made since the builder opened. `shortcut` handles
 * the dialog's own keys, returning whether it did, since workspace key handlers never see them. */
export function guardBuilderDialog(dialog: HTMLDialogElement, discard: () => boolean | Promise<boolean>,
  shortcut: (event: KeyboardEvent) => boolean = () => false) {
  let confirming = false;
  async function requestClose() {
    if (confirming) return;
    confirming = true;
    const close = await discard();
    confirming = false;
    if (close) dialog.close();
  }
  dialog.querySelectorAll<HTMLButtonElement>('[data-close]').forEach(button => button.addEventListener('click', () => void requestClose()));
  // Handle Escape directly: Chromium may skip the cancel event for repeated close
  // requests without user activation. The open confirmation stops Escape before this.
  dialog.addEventListener('keydown', event => {
    if (event.key !== 'Escape' || event.defaultPrevented) return;
    event.preventDefault();
    void requestClose();
  });
  // Other close requests, such as a platform back gesture, also confirm first.
  dialog.addEventListener('cancel', event => { event.preventDefault(); void requestClose(); });
  // Keep workspace navigation and save shortcuts out of this modal while allowing typing.
  window.addEventListener('keydown', event => {
    // The discard confirmation above this dialog handles its own keys.
    if (!dialog.open || confirming) return;
    event.stopImmediatePropagation();
    if (shortcut(event)) event.preventDefault();
    else if (event.key === 'Escape') { event.preventDefault(); void requestClose(); }
    else if ((event.metaKey || event.ctrlKey) && ['s', '/', '?'].includes(event.key.toLowerCase())) event.preventDefault();
    else if (event.key === 'Backspace' && !(event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement)) event.preventDefault();
  }, { capture: true });
}
