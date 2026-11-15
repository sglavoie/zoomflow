import type { DocumentPane } from './document-pane';
import { examples } from './examples';

type Command = { name: string; shortcut?: string; control: HTMLElement; run: () => void };

/** Reuse the workspace's controls, including their disabled state and active-pane routing. */
export function setupCommandPalette(activePane: () => DocumentPane) {
  const mac = /Mac|iPhone|iPad/.test(navigator.platform);
  const mod = mac ? '⌘' : 'Ctrl+';
  const trigger = document.querySelector<HTMLButtonElement>('#show-command-palette')!;
  const dialog = document.createElement('dialog');
  dialog.id = 'command-palette';
  dialog.setAttribute('aria-labelledby', 'command-palette-title');
  dialog.innerHTML = '<div class="shortcuts-heading"><h2 id="command-palette-title">Command palette</h2><button type="button" class="button-quiet" aria-label="Close command palette">Close</button></div><label class="zf-visually-hidden" for="command-query">Find a command</label><input id="command-query" type="text" role="combobox" aria-autocomplete="list" aria-expanded="true" aria-controls="command-results" autocomplete="off" spellcheck="false" placeholder="Find a command, board or example…" /><div id="command-results" role="listbox" aria-label="Commands"></div><p class="command-empty" role="status" hidden>No matching commands.</p><p class="command-help">↑ ↓ to choose · Enter to run · Esc to close</p>';
  document.body.append(dialog);
  const input = dialog.querySelector('input')!;
  const results = dialog.querySelector<HTMLElement>('#command-results')!;
  const empty = dialog.querySelector<HTMLElement>('.command-empty')!;
  const closeButton = dialog.querySelector('button')!;
  let origin: HTMLElement | SVGElement | null = null;
  let commands: Command[] = [];
  let matches: Command[] = [];
  let selected = 0;
  let composing = false;

  function available(control: HTMLElement) {
    if (!control.isConnected || control.matches(':disabled, [aria-disabled="true"]') || control.closest('[inert]')) return false;
    // Collapsed workspace panels and picker filters do not make their commands unavailable.
    // Hidden actions (such as Present before a walkthrough) still do.
    for (let node: HTMLElement | null = control; node; node = node.parentElement) {
      if (node.hidden && !node.matches('[data-part="source-pane"], [data-part="preview-pane"], #header-more-content, #example-options, #example-options > .example-row')) return false;
    }
    return true;
  }

  function collect() {
    const all: Command[] = [];
    const pane = activePane();
    function add(name: string, control: HTMLElement | null, shortcut?: string, run?: () => void) {
      if (control && available(control)) all.push({ name, control, shortcut, run: run ?? (() => control.click()) });
    }
    const global = (name: string, selector: string, shortcut?: string) => add(name, document.querySelector(selector), shortcut);
    const local = (name: string, selector: string, shortcut?: string) => add(name, pane.root.querySelector(selector), shortcut);
    global('New flow', '#new-flow');
    global('New mind map', '#new-mind-map');
    global('Open .d2', '#file');
    global('Open folder', '#open-folder');
    local('Save .d2', '[data-part="save-file"]', `${mod}S`);
    global('Export', '#header-more-toggle');
    const find = pane.root.querySelector<HTMLElement>('.diagram-search-trigger');
    add('Find in diagram', find, find?.hasAttribute('aria-keyshortcuts') ? `${mod}Shift+F` : undefined);
    local('Walkthrough', '.zf-walkthrough-trigger');
    local('Present', '.zf-present-toggle');
    local('Fullscreen', '.zf-fullscreen-toggle');
    local('Overview', '.zf-fit', '0');
    global(pane.views.sourceVisible ? 'Hide Source' : 'Show Source', '#toggle-source');
    local('Format', '[data-part="format-source"]', 'Shift+Alt+F');
    for (const button of document.querySelectorAll<HTMLButtonElement>('#theme button')) add(`Theme: ${button.textContent}`, button);
    const layout = document.querySelector<HTMLSelectElement>('#layout')!;
    for (const option of layout.options) if (!option.disabled) add(`Layout: ${option.textContent}`, layout, undefined, () => {
      layout.value = option.value;
      layout.dispatchEvent(new Event('change', { bubbles: true }));
    });
    global('D2 reference', '#toggle-reference', `${mod}Shift+/`);
    global('Keyboard shortcuts', '#show-shortcuts');
    const edit = pane.root.querySelector<HTMLButtonElement>('[data-group="edit"] > button');
    if (edit) add(edit.textContent!.trim(), edit);
    for (const button of pane.root.querySelectorAll<HTMLButtonElement>('.board-outline-open')) {
      add(`Go to board: ${button.firstElementChild!.textContent}`, button);
    }
    for (const example of examples) {
      add(`Open example: ${example.title}`, document.querySelector(`[data-example-command="${example.name}"]`));
    }
    return all;
  }

  function highlight() {
    [...results.children].forEach((node, index) => node.setAttribute('aria-selected', String(index === selected)));
    const option = results.children[selected];
    if (option) {
      input.setAttribute('aria-activedescendant', option.id);
      option.scrollIntoView({ block: 'nearest' });
    } else input.removeAttribute('aria-activedescendant');
  }
  function render() {
    const query = input.value.trim().toLocaleLowerCase();
    const wordStart = (name: string) => {
      const lower = name.toLocaleLowerCase();
      for (let at = lower.indexOf(query); at >= 0; at = lower.indexOf(query, at + 1)) {
        if (at === 0 || !/[\p{L}\p{N}]/u.test(lower[at - 1])) return true;
      }
      return false;
    };
    matches = commands.filter(command => available(command.control) && command.name.toLocaleLowerCase().includes(query))
      .sort((a, b) => Number(wordStart(b.name)) - Number(wordStart(a.name)));
    selected = 0;
    results.replaceChildren(...matches.map((command, index) => {
      const option = document.createElement('div');
      option.id = `command-option-${index}`;
      option.setAttribute('role', 'option');
      option.setAttribute('aria-label', command.name);
      if (command.shortcut) option.setAttribute('aria-description', command.shortcut);
      const name = document.createElement('span');
      name.textContent = command.name;
      option.append(name);
      if (command.shortcut) {
        const hint = document.createElement('kbd');
        hint.textContent = command.shortcut;
        option.append(hint);
      }
      option.addEventListener('click', event => {
        // The outer result click must not dismiss a menu that its control just opened.
        event.stopPropagation();
        execute(command);
      });
      return option;
    }));
    empty.hidden = matches.length !== 0;
    highlight();
  }
  function close() {
    dialog.close();
    // Restore before dispatch: an action may open a different dialog or move to another pane.
    if (origin?.isConnected) {
      const menu = origin.closest('details');
      (menu && !menu.open ? menu.querySelector('summary')! : origin).focus({ preventScroll: true });
    }
  }
  function execute(command: Command) {
    if (!available(command.control)) { commands = collect(); render(); return; }
    close();
    command.run();
  }
  function open(fromMenu = false) {
    if (composing || document.querySelector('dialog[open]')) return;
    origin = fromMenu ? trigger : document.activeElement as HTMLElement | SVGElement | null;
    commands = collect();
    input.value = '';
    // Presentation marks body siblings inert; a modal remains usable above it.
    dialog.inert = false;
    dialog.showModal();
    render();
    input.focus();
  }
  trigger.addEventListener('click', () => open(true));
  closeButton.addEventListener('click', close);
  dialog.addEventListener('cancel', event => { event.preventDefault(); if (!composing) close(); });
  input.addEventListener('input', () => { if (!composing) render(); });
  window.addEventListener('compositionstart', () => { composing = true; }, { capture: true });
  window.addEventListener('compositionend', () => { composing = false; if (dialog.open) render(); }, { capture: true });
  // Capture ahead of CodeMirror and workspace shortcuts. Native input editing still runs.
  window.addEventListener('keydown', event => {
    if (dialog.open) {
      event.stopImmediatePropagation();
      if (event.isComposing || composing) return;
      if (event.key === 'Escape') { event.preventDefault(); close(); }
      else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        if (matches.length) selected = (selected + (event.key === 'ArrowDown' ? 1 : -1) + matches.length) % matches.length;
        input.focus();
        highlight();
      } else if (event.key === 'Enter' && event.target === input) {
        event.preventDefault();
        if (matches[selected]) execute(matches[selected]);
      } else if ((event.metaKey || event.ctrlKey) && ['s', 'k', '/', '?'].includes(event.key.toLowerCase())) {
        event.preventDefault();
      } else if (event.key === 'Tab') {
        event.preventDefault();
        (document.activeElement === input ? closeButton : input).focus();
      }
      return;
    }
    if (event.isComposing || composing || event.repeat || event.altKey || event.shiftKey ||
      !(mac ? event.metaKey : event.ctrlKey) || event.key.toLowerCase() !== 'k' || document.querySelector('dialog[open]')) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    open();
  }, { capture: true });
}
