import { setText } from './text';

/** Native modal semantics, shared copy layout and a keyboard-reachable undo notice. */
export function setupDocumentActions(returnFocus: () => void) {
  const dialog = document.createElement('dialog');
  dialog.id = 'document-action';
  dialog.setAttribute('aria-labelledby', 'document-action-title');
  dialog.setAttribute('aria-describedby', 'document-action-description');
  dialog.innerHTML = '<h2 id="document-action-title"></h2><p id="document-action-description"></p><div class="document-action-buttons"><button type="button" autofocus>Cancel</button><button type="button" class="button-primary"></button></div>';
  const [cancel, confirm] = [...dialog.querySelectorAll('button')];
  const notice = document.createElement('div');
  notice.id = 'document-undo';
  // The status stays rendered so its message is announced; the notice collapses while it is empty.
  notice.innerHTML = '<span role="status"></span><button type="button" hidden>Undo</button><button type="button" class="button-quiet" aria-label="Dismiss undo notice" hidden>Dismiss</button>';
  const status = notice.querySelector('span')!;
  const [undo, dismiss] = [...notice.querySelectorAll('button')];
  document.body.append(dialog, notice);
  let resolve: ((confirmed: boolean) => void) | undefined;
  let focusAfter: (() => void) | undefined;
  let pending: (() => void) | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expire = () => {
    clearTimeout(timer);
    pending = undefined;
    if (notice.contains(document.activeElement)) returnFocus();
    setText(status, '');
    undo.hidden = dismiss.hidden = true;
  };
  cancel.onclick = () => dialog.close('cancel');
  confirm.onclick = () => dialog.close('confirm');
  dialog.addEventListener('close', () => {
    const done = resolve;
    resolve = undefined;
    (focusAfter ?? returnFocus)();
    focusAfter = undefined;
    done?.(dialog.returnValue === 'confirm');
  });
  window.addEventListener('keydown', event => {
    if (!dialog.open) return;
    // Stop diagram navigation and workspace shortcuts while confirming an action.
    event.stopImmediatePropagation();
    if (event.key === 'Escape') { event.preventDefault(); dialog.close('cancel'); }
    else if (event.key === 'Backspace' || (event.metaKey || event.ctrlKey) && event.key === 's') event.preventDefault();
  }, { capture: true });
  undo.onclick = () => { const action = pending; expire(); action?.(); };
  dismiss.onclick = expire;
  // Keep the action available while someone is interacting with its notice.
  const schedule = () => { clearTimeout(timer); if (pending) timer = setTimeout(expire, 30_000); };
  notice.addEventListener('pointerenter', () => clearTimeout(timer));
  notice.addEventListener('pointerleave', schedule);
  notice.addEventListener('focusin', () => clearTimeout(timer));
  notice.addEventListener('focusout', event => { if (!notice.contains(event.relatedTarget as Node | null)) schedule(); });
  return {
    /** `focus` replaces the default focus return, for confirmations asked outside the diagram menu. */
    confirm(title: string, description: string, action: string, focus?: () => void) {
      focusAfter = focus;
      dialog.querySelector('h2')!.textContent = title;
      dialog.querySelector('p')!.textContent = description;
      confirm.textContent = action;
      dialog.returnValue = 'cancel';
      dialog.showModal();
      cancel.focus();
      return new Promise<boolean>(done => { resolve = done; });
    },
    offerUndo(message: string, action: () => void) {
      expire();
      pending = action;
      setText(status, message);
      undo.hidden = dismiss.hidden = false;
      schedule();
    },
    expire,
  };
}
