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
const presets = [
  { name: 'Outline', look: { filled: false, compact: false, shadow: false } },
  { name: 'Soft', look: { filled: true, compact: false, shadow: false } },
  { name: 'Elevated', look: { filled: true, compact: false, shadow: true } },
] as const;

function lookThumbnail(look: Look) {
  return `<svg viewBox="0 0 180 82" aria-hidden="true" class="look-thumbnail${look.filled ? ' look-filled' : ''}${look.shadow ? ' look-shadow' : ''}"><path class="look-connector" d="M43 41H69m38 0h30"/><path d="m65 38 4 3-4 3m68-3 4 3-4 3"/><rect x="5" y="27" width="38" height="28" rx="7"/><path class="look-decision" d="M88 20 109 41 88 62 67 41Z"/><rect class="look-outcome" x="137" y="27" width="38" height="28" rx="14"/><g class="look-labels" fill="currentColor" stroke="none" font-family="system-ui, sans-serif" font-size="8" text-anchor="middle"><text x="24" y="44">Step</text><text x="88" y="44">Yes?</text><text x="156" y="44">Done</text></g></svg>`;
}

/** Look choices for a builder whose ids start with `prefix`. They only add library classes,
 * so a project's own zoomflow.d2 can restyle them. */
export function lookFields(prefix: string) {
  return `<details class="builder-appearance"><summary>Appearance <span>Style presets and finishing touches</span></summary><fieldset class="builder-look"><legend>Look</legend>
        <div class="look-presets" role="group" aria-label="Diagram style">${presets.map((preset, index) => `<button type="button" data-look-preset="${index}" aria-pressed="false">${lookThumbnail(preset.look)}<span>${preset.name}</span></button>`).join('')}</div>
        <details class="look-custom"><summary>Customize style</summary><div>
        ${lookNames.map(name => `<label><input id="${prefix}-${name}" type="checkbox" /> ${lookLabels[name]}</label>`).join('\n        ')}
        </div><details class="look-source"><summary>Project styling</summary>
        <p id="${prefix}-look-help" class="flow-help">Adds the library's ${lookNames.map(name => `zf-${name}`).join(', ')} classes. Restyle them in your project's zoomflow.d2.</p>
        </details></details>
      </fieldset></details>`;
}

/** Read and set the checkboxes `lookFields` wrote. */
export function lookControls(dialog: HTMLElement, prefix: string) {
  const boxes = lookNames.map(name => [name, dialog.querySelector<HTMLInputElement>(`#${prefix}-${name}`)!] as const);
  const buttons = [...dialog.querySelectorAll<HTMLButtonElement>('[data-look-preset]')];
  function sync() {
    for (const [index, button] of buttons.entries()) {
      button.setAttribute('aria-pressed', String(boxes.every(([name, box]) => box.checked === presets[index].look[name])));
    }
  }
  for (const [index, button] of buttons.entries()) button.addEventListener('click', () => {
    for (const [name, box] of boxes) box.checked = presets[index].look[name];
    // The same events update the builder's model, dirty guard, and live preview.
    boxes[0][1].dispatchEvent(new Event('change', { bubbles: true }));
    sync();
  });
  for (const [, box] of boxes) box.addEventListener('change', sync);
  return {
    boxes: boxes.map(([, box]) => box),
    get: () => Object.fromEntries(boxes.map(([name, box]) => [name, box.checked])) as Look,
    set(look: Look) { for (const [name, box] of boxes) box.checked = look[name]; sync(); },
  };
}
