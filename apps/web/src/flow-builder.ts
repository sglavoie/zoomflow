import { guardBuilderDialog, lookControls, lookFields, type BuilderTarget } from './builder-dialog';
import { plural, setText } from './text';
import { flowFilename, flowSource, flowTemplate, readFlow, type Flow, type FlowStep } from './flow-model';

/** One builder dialog: New flow creates a draft, and each pane opens it to add or edit a flow board. */
export function setupFlowBuilder(create: (source: string, name: string) => void,
  confirmDiscard: (title: string, description: string, action: string, focus: () => void) => Promise<boolean>) {
  const launch = document.querySelector<HTMLButtonElement>('#new-flow')!;
  const dialog = document.createElement('dialog');
  dialog.id = 'flow-builder';
  dialog.setAttribute('aria-labelledby', 'flow-builder-title');
  dialog.setAttribute('aria-describedby', 'flow-builder-description');
  dialog.innerHTML = `
    <form>
      <div class="flow-heading"><h2 id="flow-builder-title">Create a flow</h2><button type="button" data-close aria-label="Close flow builder">Close</button></div>
      <p id="flow-builder-description">Name your steps, then choose what happens next. No diagram syntax needed.</p>
      <div class="flow-settings">
        <label id="flow-name-field"><span>Flow name</span><input id="flow-name" value="My flow" required maxlength="100" /></label>
        <label>Layout<select id="flow-direction"><option value="down">Top to bottom</option><option value="right">Left to right</option></select></label>
      </div>
      ${lookFields('flow')}
      <fieldset id="flow-starters"><legend>Start with an example</legend><button type="button" data-template="simple">Simple flow</button> <button type="button" data-template="approval">Approval with Yes / No</button></fieldset>
      <section aria-labelledby="flow-steps-heading">
        <h3 id="flow-steps-heading">1. Name the steps</h3>
        <p class="flow-help">Use an action like “Review request”. Choose Decision for a question with different outcomes.</p>
        <div id="flow-steps"></div>
        <button id="flow-add-step" type="button">Add step</button>
      </section>
      <section aria-labelledby="flow-connections-heading">
        <h3 id="flow-connections-heading">2. Connect the steps</h3>
        <p class="flow-help">Each connection draws an arrow. Add two from a decision and label them Yes and No.</p>
        <div id="flow-connections"></div>
        <button id="flow-add-connection" type="button">Add connection</button>
      </section>
      <p id="flow-feedback" role="status"></p>
      <p id="flow-error" role="alert" hidden></p>
      <div class="flow-footer"><span id="flow-save-hint">Creates a new draft. Your current diagram is kept.</span><button type="button" data-close>Cancel</button><button class="button-primary" type="submit">Create flow</button></div>
    </form>`;
  document.body.append(dialog);
  const form = dialog.querySelector('form')!;
  const name = dialog.querySelector<HTMLInputElement>('#flow-name')!;
  const direction = dialog.querySelector<HTMLSelectElement>('#flow-direction')!;
  const look = lookControls(dialog, 'flow');
  const steps = dialog.querySelector<HTMLElement>('#flow-steps')!;
  const connections = dialog.querySelector<HTMLElement>('#flow-connections')!;
  const feedback = dialog.querySelector<HTMLElement>('#flow-feedback')!;
  const error = dialog.querySelector<HTMLElement>('#flow-error')!;
  const addStep = dialog.querySelector<HTMLButtonElement>('#flow-add-step')!;
  const addConnection = dialog.querySelector<HTMLButtonElement>('#flow-add-connection')!;
  const submit = dialog.querySelector<HTMLButtonElement>('[type="submit"]')!;
  let flow: Flow = flowTemplate('simple');
  /** The highest step number since the builder opened. New steps never reuse a removed step's identifier,
   * so a board that opened from the removed step does not move to the new one. */
  let highest = 0;
  const highestStep = () => Math.max(highest, ...flow.steps.map(step => Number(step.id.slice(5))));
  let editing = false;
  /** The form when the builder opened; closing asks before discarding later changes. */
  let snapshot = '';
  const formState = () => `${editing ? '' : name.value}\n${flowSource(flow)}`;
  /** The steps and connections as last loaded; an example replaces them without asking until they change. */
  let loaded = '';
  const stepsState = () => JSON.stringify([flow.steps, flow.connections]);
  let returnFocus: HTMLElement = launch;
  /** Where focus goes when `returnFocus` is gone or hidden by the time the builder closes. */
  let fallbackFocus: HTMLElement | undefined;
  const draft = (): BuilderTarget => ({ mode: 'draft', name: 'My flow', apply: (source, title) => { create(source, flowFilename(title)); } });
  let target = draft();

  function announce() {
    setText(feedback, `${plural(flow.steps.length, 'step')} · ${plural(flow.connections.length, 'connection')}`);
    addConnection.disabled = flow.steps.length < 2;
    error.hidden = true;
  }
  function field(text: string, control: HTMLElement) {
    const label = document.createElement('label');
    label.append(text, control);
    return label;
  }
  function removeButton(label: string, action: () => void) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = 'Remove';
    button.setAttribute('aria-label', label);
    button.addEventListener('click', action);
    return button;
  }
  function refreshChoices() {
    for (const select of connections.querySelectorAll<HTMLSelectElement>('select')) {
      const selected = select.value;
      select.replaceChildren(...flow.steps.map((step, i) => new Option(`${i + 1}. ${step.label || 'Unnamed step'}`, step.id)));
      select.value = selected;
    }
  }
  function renderConnections() {
    connections.replaceChildren();
    flow.connections.forEach((edge, i) => {
      const row = document.createElement('div');
      row.className = 'flow-connection';
      for (const [key, label] of [['from', 'From'], ['to', 'To']] as const) {
        const select = document.createElement('select');
        select.setAttribute('aria-label', `Connection ${i + 1} ${label.toLowerCase()}`);
        select.append(...flow.steps.map((step, j) => new Option(`${j + 1}. ${step.label || 'Unnamed step'}`, step.id)));
        select.value = edge[key];
        select.addEventListener('change', () => { edge[key] = select.value; announce(); });
        row.append(field(label, select));
      }
      const label = document.createElement('input');
      label.value = edge.label;
      label.placeholder = 'e.g. Yes';
      label.setAttribute('aria-label', `Connection ${i + 1} label`);
      label.addEventListener('input', () => { edge.label = label.value; });
      row.append(field('Label (optional)', label), removeButton(`Remove connection ${i + 1}`, () => {
        flow.connections.splice(i, 1);
        renderConnections();
        // Keep focus near the removed row: the next connection, else the previous one.
        (connections.children[Math.min(i, flow.connections.length - 1)]?.querySelector<HTMLButtonElement>('button') ?? addConnection).focus();
      }));
      connections.append(row);
    });
    announce();
  }
  function renderSteps() {
    steps.replaceChildren();
    flow.steps.forEach((step, i) => {
      const row = document.createElement('div');
      row.className = 'flow-step';
      const label = document.createElement('input');
      label.required = true;
      label.value = step.label;
      label.placeholder = 'What happens here?';
      label.setAttribute('aria-label', `Step ${i + 1} name`);
      label.addEventListener('input', () => {
        step.label = label.value;
        label.setCustomValidity(label.value.trim() ? '' : 'Give this step a name.');
        refreshChoices();
      });
      const shape = document.createElement('select');
      shape.setAttribute('aria-label', `Step ${i + 1} type`);
      shape.append(new Option('Action', 'rectangle'), new Option('Decision', 'diamond'), new Option('Start / End', 'oval'));
      shape.value = step.shape;
      shape.addEventListener('change', () => { step.shape = shape.value as FlowStep['shape']; });
      const remove = removeButton(`Remove step ${i + 1}`, () => {
        flow.steps.splice(i, 1);
        flow.connections = flow.connections.filter(edge => edge.from !== step.id && edge.to !== step.id);
        renderSteps(); renderConnections();
        (steps.querySelectorAll('input')[Math.min(i, flow.steps.length - 1)] ?? addStep).focus();
        feedback.textContent += ' · Step and its connections removed.';
      });
      remove.disabled = flow.steps.length === 1;
      row.append(field(`Step ${i + 1}`, label), field('Type', shape), remove);
      steps.append(row);
    });
  }
  function render() {
    direction.value = flow.direction;
    look.set(flow.look);
    renderSteps(); renderConnections();
  }
  function open(next: BuilderTarget, edit?: HTMLElement, fallback?: HTMLElement) {
    const existing = next.mode === 'edit' ? readFlow(next.source ?? '') : undefined;
    if (next.mode === 'edit' && !existing) return;
    target = next;
    editing = next.mode === 'edit';
    flow = existing ?? flowTemplate('simple');
    highest = 0;
    highest = highestStep();
    returnFocus = edit ?? launch;
    fallbackFocus = fallback;
    name.value = next.name;
    name.setCustomValidity('');
    dialog.querySelector('#flow-name-field span')!.textContent = next.mode === 'board' ? 'Board name' : 'Flow name';
    dialog.querySelector<HTMLElement>('#flow-name-field')!.hidden = editing;
    dialog.querySelector<HTMLElement>('#flow-starters')!.hidden = editing;
    dialog.querySelector('h2')!.textContent = { draft: 'Create a flow', board: 'Add a flow board', edit: 'Edit flow' }[next.mode];
    submit.textContent = { draft: 'Create flow', board: 'Add board', edit: 'Apply changes' }[next.mode];
    dialog.querySelector('#flow-save-hint')!.textContent = {
      draft: 'Creates a new draft. Your current diagram is kept.',
      board: 'Adds a board that opens from the shape. Undo with ⌘Z / Ctrl+Z on the diagram or in the source.',
      edit: 'Updates this flow. Undo with ⌘Z / Ctrl+Z on the diagram or in the source.' }[next.mode];
    render();
    snapshot = formState();
    loaded = stepsState();
    returnFocus.focus({ preventScroll: true });
    dialog.showModal();
    (editing ? steps.querySelector('input')! : name).focus();
  }
  launch.addEventListener('click', () => open(draft()));
  // Enter in a step or label moves on instead of submitting a flow that is still being written.
  // The dialog guard stops keys before they reach the form, so it runs this as its shortcut.
  function enterMovesOn(event: KeyboardEvent) {
    const input = event.target;
    if (event.key !== 'Enter' || event.metaKey || event.ctrlKey || event.isComposing || !(input instanceof HTMLInputElement)
      || !(steps.contains(input) || connections.contains(input))) return false;
    if (!steps.contains(input)) return true;
    const inputs = [...steps.querySelectorAll('input')];
    const next = inputs[inputs.indexOf(input) + 1];
    if (next) next.focus();
    else if (input.value.trim()) addStep.click();
    return true;
  }
  const guard = guardBuilderDialog(dialog, () => {
    if (formState() === snapshot) return true;
    const focused = document.activeElement;
    return confirmDiscard(editing ? 'Discard flow changes?' : 'Discard this flow?',
      editing ? 'Closing the builder discards the steps and connections you changed. Your diagram is unchanged.'
        : `Closing the builder discards the flow you started. ${target.mode === 'board' ? 'No board is added.' : 'No draft is created.'}`,
      'Discard changes', () => (focused instanceof HTMLElement && dialog.contains(focused) ? focused : submit).focus({ preventScroll: true }));
  }, enterMovesOn);
  dialog.addEventListener('close', () => ([returnFocus, fallbackFocus].find(element => element?.isConnected && !element.closest('[hidden]')) ?? launch)
    .focus({ preventScroll: true }));
  name.addEventListener('input', () => name.setCustomValidity(name.value.trim() ? '' : `Give your ${target.mode === 'board' ? 'board' : 'flow'} a name.`));
  direction.addEventListener('change', () => { flow.direction = direction.value as Flow['direction']; });
  for (const box of look.boxes) box.addEventListener('change', () => { flow.look = look.get(); });
  dialog.querySelectorAll<HTMLButtonElement>('[data-template]').forEach(button => button.addEventListener('click', async () => {
    if (stepsState() !== loaded && !await guard.ask(() => confirmDiscard('Replace your steps?',
      'The example replaces the steps and connections you entered. Your flow name and look are kept.', 'Replace steps',
      () => button.focus({ preventScroll: true })))) return;
    highest = highestStep();
    flow = { ...flowTemplate(button.dataset.template!), look: flow.look };
    render();
    loaded = stepsState();
  }));
  addStep.addEventListener('click', () => {
    const last = flow.steps.at(-1)!;
    highest = highestStep() + 1;
    const id = `step_${highest}`;
    flow.steps.push({ id, label: '', shape: 'rectangle' });
    flow.connections.push({ from: last.id, to: id, label: '' });
    render();
    steps.querySelectorAll('input')[flow.steps.length - 1].focus();
    feedback.textContent += ' · Connected from the previous step. You can change this below.';
  });
  addConnection.addEventListener('click', () => {
    flow.connections.push({ from: flow.steps[0].id, to: flow.steps[1].id, label: '' });
    renderConnections();
    connections.lastElementChild!.querySelector('select')!.focus();
  });
  form.addEventListener('submit', event => {
    event.preventDefault();
    const problem = target.apply(flowSource(flow), name.value.trim());
    if (problem) {
      error.textContent = problem;
      error.hidden = false;
      return;
    }
    dialog.close();
  });
  return {
    /** Add a flow board or edit one; `returnFocus`, else `fallback`, regains focus when the builder closes. */
    open: (next: BuilderTarget, returnFocus: HTMLElement, fallback?: HTMLElement) => open(next, returnFocus, fallback),
  };
}
