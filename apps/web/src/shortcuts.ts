/** The key ⌘S or Ctrl+S presses: S by the letter it types, or by its place on layouts whose S key types a letter
 * outside the Latin alphabet. Layouts such as Colemak or Dvorak type another Latin letter there, such as R or O,
 * whose own shortcuts must keep working. */
export function isSaveKey(event: KeyboardEvent) {
  const key = event.key.toLowerCase();
  return key === 's' || !/^[a-z]$/.test(key) && event.code === 'KeyS';
}

/** Native modal focus handling keeps the shortcut reference keyboard accessible. */
export function setupShortcuts() {
  const button = document.querySelector<HTMLButtonElement>('#show-shortcuts')!;
  const dialog = document.querySelector<HTMLDialogElement>('#keyboard-shortcuts')!;
  const close = document.querySelector<HTMLButtonElement>('#close-shortcuts')!;

  button.addEventListener('click', () => {
    // Safari does not focus buttons on pointer clicks; use a consistent return target.
    button.focus({ preventScroll: true });
    dialog.showModal();
  });
  close.addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => button.focus({ preventScroll: true }));

  // Register before the workspace handlers so reading help cannot navigate
  // boards or change the workspace. Leave native scrolling available.
  window.addEventListener('keydown', (event) => {
    if (!dialog.open) return;
    event.stopImmediatePropagation();
    if (event.key === 'Escape') {
      event.preventDefault();
      dialog.close();
    } else if (event.key === 'Backspace') {
      // WebKit can otherwise navigate browser history from a non-editable control.
      event.preventDefault();
    }
    if (event.key === 'Tab') {
      // Close is the only interactive control; keep focus in the dialog.
      event.preventDefault();
      close.focus({ preventScroll: true });
    }
    if ((event.metaKey || event.ctrlKey) && (['/', '?'].includes(event.key) || isSaveKey(event))) {
      event.preventDefault();
    }
  }, { capture: true });
}
