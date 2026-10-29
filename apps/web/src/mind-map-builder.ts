import { guardBuilderDialog, lookControls, lookFields, type BuilderTarget } from './builder-dialog';
import { flowFilename, plainLook } from './flow-model';
import { countTopics, mindMapExample, mindMapSource, outlineText, parseOutline, readMindMap, type MindMap } from './mind-map-model';
import { plural, setText } from './text';

/** One outline dialog: New mind map creates a draft, and each pane opens it to add or edit a mind map board. */
export function setupMindMapBuilder(create: (source: string, name: string) => void,
  confirmDiscard: (title: string, description: string, action: string, focus: () => void) => Promise<boolean>) {
  const launch = document.querySelector<HTMLButtonElement>('#new-mind-map')!;
  const dialog = document.createElement('dialog');
  dialog.id = 'mind-map-builder';
  dialog.setAttribute('aria-labelledby', 'mind-map-builder-title');
  dialog.setAttribute('aria-describedby', 'mind-map-builder-description');
  dialog.innerHTML = `
    <form>
      <div class="flow-heading"><h2 id="mind-map-builder-title">Create a mind map</h2><button type="button" data-close aria-label="Close mind map builder">Close</button></div>
      <p id="mind-map-builder-description">Write one topic per line. No diagram syntax needed.</p>
      <div class="flow-settings">
        <label id="mind-map-name-field"><span>Mind map name</span><input id="mind-map-name" value="My mind map" required maxlength="100" /></label>
        <label>Layout<select id="mind-map-direction"><option value="right">Left to right</option><option value="down">Top to bottom</option></select></label>
      </div>
      <section aria-labelledby="mind-map-outline-heading">
        <h3 id="mind-map-outline-heading">Topics</h3>
        <p id="mind-map-outline-help" class="flow-help">The first line is the central topic. Indent a line to make it a subtopic of the line above it, with spaces or the Indent button (⌘] / Ctrl+]). Bullets are optional, so you can paste a Markdown list.</p>
        <textarea id="mind-map-outline" aria-labelledby="mind-map-outline-heading" aria-describedby="mind-map-outline-help" rows="14" spellcheck="true" required></textarea>
        <div class="mind-map-indent"><button id="mind-map-outdent" type="button" title="Outdent (⌘[ / Ctrl+[)">Outdent</button><button id="mind-map-indent" type="button" title="Indent (⌘] / Ctrl+])">Indent</button></div>
      </section>
      <label class="mind-map-split">Detail boards<select id="mind-map-split" aria-describedby="mind-map-split-help">
        <option value="0">Keep every topic on one board</option>
        <option value="1">Open each main branch on its own board</option>
        <option value="2">Open level 2 topics on their own boards</option>
        <option value="3">Open level 3 topics on their own boards</option>
        <option value="4">Open level 4 topics on their own boards</option>
      </select></label>
      <p id="mind-map-split-help" class="flow-help">A topic at this level that has subtopics links to a board of its own. The arrow badge on it in the diagram opens that board.</p>
      ${lookFields('mind-map')}
      <p id="mind-map-feedback" role="status"></p>
      <p id="mind-map-error" role="alert" hidden></p>
      <div class="flow-footer"><span id="mind-map-save-hint">Creates a new draft. Your current diagram is kept.</span><button type="button" data-close>Cancel</button><button class="button-primary" type="submit">Create mind map</button></div>
    </form>`;
  document.body.append(dialog);
  const form = dialog.querySelector('form')!;
  const name = dialog.querySelector<HTMLInputElement>('#mind-map-name')!;
  const direction = dialog.querySelector<HTMLSelectElement>('#mind-map-direction')!;
  const outline = dialog.querySelector<HTMLTextAreaElement>('#mind-map-outline')!;
  const split = dialog.querySelector<HTMLSelectElement>('#mind-map-split')!;
  const look = lookControls(dialog, 'mind-map');
  const feedback = dialog.querySelector<HTMLElement>('#mind-map-feedback')!;
  const error = dialog.querySelector<HTMLElement>('#mind-map-error')!;
  const submit = dialog.querySelector<HTMLButtonElement>('[type="submit"]')!;
  let editing = false;
  /** The form when the builder opened; closing asks before discarding later changes. */
  let snapshot = '';
  const formState = () => `${editing ? '' : name.value}\n${direction.value}\n${split.value}\n${JSON.stringify(look.get())}\n${outline.value}`;
  let returnFocus: HTMLElement = launch;
  /** Where focus goes when `returnFocus` is gone or hidden by the time the builder closes. */
  let fallbackFocus: HTMLElement | undefined;
  const draft = (): BuilderTarget => ({ mode: 'draft', name: 'My mind map',
    apply: (source, title) => { create(source, flowFilename(title, 'My mind map')); } });
  let target = draft();

  function current(): MindMap | undefined {
    const root = parseOutline(outline.value);
    return root && { direction: direction.value as MindMap['direction'], split: Number(split.value),
      look: look.get(), root };
  }
  function announce() {
    const map = current();
    const { topics, boards } = map ? countTopics(map) : { topics: 0, boards: 0 };
    setText(feedback, topics ? `${plural(topics, 'topic')} · ${boards ? plural(boards, 'detail board') : 'one board'}` : 'Write a central topic to begin.');
    outline.setCustomValidity(topics ? '' : 'Write a central topic on the first line.');
    error.hidden = true;
  }
  /** Indent or outdent every line the selection touches, keeping the browser's undo history. */
  function shift(direction: 1 | -1) {
    const { value, selectionStart, selectionEnd } = outline;
    const start = value.lastIndexOf('\n', selectionStart - 1) + 1;
    const endBreak = value.indexOf('\n', selectionEnd - (selectionEnd > selectionStart && value[selectionEnd - 1] === '\n' ? 1 : 0));
    const end = endBreak < 0 ? value.length : endBreak;
    const lines = value.slice(start, end).split('\n');
    const changed = lines.map(line => direction > 0 ? (line.trim() ? `  ${line}` : line) : line.replace(/^(?: {1,2}|\t)/, ''));
    const text = changed.join('\n');
    outline.focus();
    if (text === lines.join('\n')) return;
    outline.setSelectionRange(start, end);
    if (!document.execCommand('insertText', false, text)) outline.setRangeText(text, start, end, 'end');
    // Keep the caret on the same text, or select the whole shifted block.
    const first = changed[0].length - lines[0].length;
    if (selectionStart === selectionEnd) {
      const caret = Math.max(start, selectionStart + first);
      outline.setSelectionRange(caret, caret);
    } else outline.setSelectionRange(start, start + text.length);
    announce();
  }
  function open(next: BuilderTarget, edit?: HTMLElement, fallback?: HTMLElement) {
    const existing = next.mode === 'edit' ? readMindMap(next.source ?? '') : undefined;
    if (next.mode === 'edit' && !existing) return;
    target = next;
    editing = next.mode === 'edit';
    // A board starts from its shape's label as the central topic, kept whole: outline markup such as `- ` is its text.
    const root = next.mode === 'board' ? { label: next.name.replace(/\s+/g, ' ').trim() || 'Topic',
      children: ['First idea', 'Second idea'].map(label => ({ label, children: [] })) } : parseOutline(mindMapExample)!;
    const map: MindMap = existing ?? { direction: 'right', split: 2, look: plainLook(), root };
    returnFocus = edit ?? launch;
    fallbackFocus = fallback;
    name.value = next.name;
    name.setCustomValidity('');
    dialog.querySelector('#mind-map-name-field span')!.textContent = next.mode === 'board' ? 'Board name' : 'Mind map name';
    direction.value = map.direction;
    split.value = String(map.split);
    look.set(map.look);
    outline.value = outlineText(map.root);
    dialog.querySelector<HTMLElement>('#mind-map-name-field')!.hidden = editing;
    dialog.querySelector('h2')!.textContent = { draft: 'Create a mind map', board: 'Add a mind map board', edit: 'Edit mind map' }[next.mode];
    submit.textContent = { draft: 'Create mind map', board: 'Add board', edit: 'Apply changes' }[next.mode];
    dialog.querySelector('#mind-map-save-hint')!.textContent = {
      draft: 'Creates a new draft. Your current diagram is kept.',
      board: 'Adds a board that opens from the shape. Undo with ⌘Z / Ctrl+Z on the diagram or in the source.',
      edit: 'Updates this mind map. Undo with ⌘Z / Ctrl+Z on the diagram or in the source.' }[next.mode];
    announce();
    snapshot = formState();
    returnFocus.focus({ preventScroll: true });
    dialog.showModal();
    (editing ? outline : name).focus();
    outline.setSelectionRange(0, 0);
    outline.scrollTop = 0;
  }
  launch.addEventListener('click', () => open(draft()));
  // The filename menu offers the same, for phones where the header has no room for it.
  const menuLaunch = document.querySelector<HTMLButtonElement>('#new-mind-map-picker')!;
  menuLaunch.addEventListener('click', () => {
    const picker = menuLaunch.closest('details')!;
    picker.open = false;
    open(draft(), picker.querySelector('summary')!);
  });
  guardBuilderDialog(dialog, () => {
    if (formState() === snapshot) return true;
    const focused = document.activeElement;
    return confirmDiscard(editing ? 'Discard mind map changes?' : 'Discard this mind map?',
      editing ? 'Closing the builder discards the topics you changed. Your diagram is unchanged.'
        : `Closing the builder discards the mind map you started. ${target.mode === 'board' ? 'No board is added.' : 'No draft is created.'}`,
      'Discard changes', () => (focused instanceof HTMLElement && dialog.contains(focused) ? focused : submit).focus({ preventScroll: true }));
  }, event => {
    if (event.target !== outline || !(event.metaKey || event.ctrlKey) || event.altKey || !['[', ']'].includes(event.key)) return false;
    shift(event.key === ']' ? 1 : -1);
    return true;
  });
  dialog.addEventListener('close', () => ([returnFocus, fallbackFocus].find(element => element?.isConnected && !element.closest('[hidden]')) ?? launch)
    .focus({ preventScroll: true }));
  name.addEventListener('input', () => name.setCustomValidity(name.value.trim() ? '' : `Give your ${target.mode === 'board' ? 'board' : 'mind map'} a name.`));
  outline.addEventListener('input', announce);
  split.addEventListener('change', announce);
  dialog.querySelector('#mind-map-indent')!.addEventListener('click', () => shift(1));
  dialog.querySelector('#mind-map-outdent')!.addEventListener('click', () => shift(-1));
  form.addEventListener('submit', event => {
    event.preventDefault();
    const problem = target.apply(mindMapSource(current()!), name.value.trim());
    if (problem) {
      error.textContent = problem;
      error.hidden = false;
      return;
    }
    dialog.close();
  });
  return {
    /** Add a mind map board or edit one; `returnFocus`, else `fallback`, regains focus when the builder closes. */
    open: (next: BuilderTarget, returnFocus: HTMLElement, fallback?: HTMLElement) => open(next, returnFocus, fallback),
  };
}
