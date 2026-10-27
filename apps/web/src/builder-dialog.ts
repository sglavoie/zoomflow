import { lookNames, type Look } from './flow-model';

/** Where a builder's result goes: a new draft, a new board that opens from a shape, or the board it edits.
 * `apply` returns why the result could not be applied, which the builder shows without closing. */
export type BuilderTarget = {
  mode: 'draft' | 'board' | 'edit';
  /** The draft or board name to start from; boards start from their shape's label. */
  name: string;
  /** The builder source to reopen when editing. */
  source?: string;
  apply: (source: string, name: string) => string | undefined;
};

/** Modal behaviour shared by the form builders. `discard` resolves whether closing may proceed,
 * asking first when that would discard changes made since the builder opened. `shortcut` handles
 * the dialog's own keys, returning whether it did, since workspace key handlers never see them. */
export function guardBuilderDialog(dialog: HTMLDialogElement, discard: () => boolean | Promise<boolean>,
  shortcut: (event: KeyboardEvent) => boolean = () => false) {
  let confirming = false;
  /** Ask `question` over the dialog, leaving its keys to that confirmation; false while another is open. */
  async function ask(question: () => boolean | Promise<boolean>) {
    if (confirming) return false;
    confirming = true;
    try { return await question(); } finally { confirming = false; }
  }
  async function requestClose() {
    if (await ask(discard)) dialog.close();
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
    // `code` covers layouts whose S key types another letter, as the page's own save shortcut does.
    else if ((event.metaKey || event.ctrlKey) && (['s', '/', '?'].includes(event.key.toLowerCase()) || event.code === 'KeyS')) event.preventDefault();
    else if (event.key === 'Backspace' && !(event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement)) event.preventDefault();
  }, { capture: true });
  return { ask };
}

const lookLabels: Record<keyof Look, string> = { filled: 'Filled shapes', compact: 'Compact text', shadow: 'Shadows' };

/** Look choices for a builder whose ids start with `prefix`. They only add library classes,
 * so a project's own zoomflow.d2 can restyle them. */
export function lookFields(prefix: string) {
  return `<fieldset class="builder-look" aria-describedby="${prefix}-look-help"><legend>Look</legend>
        ${lookNames.map(name => `<label><input id="${prefix}-${name}" type="checkbox" /> ${lookLabels[name]}</label>`).join('\n        ')}
        <p id="${prefix}-look-help" class="flow-help">Adds the library's ${lookNames.map(name => `zf-${name}`).join(', ')} classes. Restyle them in your project's zoomflow.d2.</p>
      </fieldset>`;
}

/** Read and set the checkboxes `lookFields` wrote. */
export function lookControls(dialog: HTMLElement, prefix: string) {
  const boxes = lookNames.map(name => [name, dialog.querySelector<HTMLInputElement>(`#${prefix}-${name}`)!] as const);
  return {
    boxes: boxes.map(([, box]) => box),
    get: () => Object.fromEntries(boxes.map(([name, box]) => [name, box.checked])) as Look,
    set(look: Look) { for (const [name, box] of boxes) box.checked = look[name]; },
  };
}
