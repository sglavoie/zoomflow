import { examples } from './examples';

/** Keep a source draft for every visited example and opened file for this page. */
export function setupExamplePicker(readSource: () => string, open: (source: string, name: string) => void) {
  const picker = document.querySelector<HTMLDetailsElement>('#example-picker')!;
  const summary = picker.querySelector('summary')!;
  const menu = picker.querySelector<HTMLElement>('.example-menu')!;
  const filename = document.querySelector<HTMLElement>('#filename')!;
  const options = document.querySelector<HTMLElement>('#example-options')!;
  const drafts = new Map<string, string>();
  const buttons = new Map<string, HTMLButtonElement>();
  let current = examples[0].name;
  let fileNumber = 0;

  function activate(key: string, name: string) {
    current = key;
    filename.textContent = name;
    for (const [id, button] of buttons) {
      if (id === current) button.setAttribute('aria-current', 'true');
      else button.removeAttribute('aria-current');
    }
  }

  function addOption(key: string, name: string, title: string, description: string, source: string) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'example-option';
    const label = document.createElement('span');
    label.className = 'example-title';
    label.textContent = title;
    const detail = document.createElement('span');
    detail.className = 'example-description';
    detail.textContent = description;
    button.append(label, detail);
    button.addEventListener('click', () => {
      picker.open = false;
      summary.focus();
      if (current === key) return;
      drafts.set(current, readSource());
      activate(key, name);
      open(drafts.get(key) ?? source, name);
    });
    buttons.set(key, button);
    options.append(button);
  }

  for (const example of examples) addOption(example.name, example.name, example.title, example.description, example.source);
  activate(current, examples[0].name);
  function positionMenu() {
    if (!picker.open) return;
    const anchor = summary.getBoundingClientRect();
    const top = anchor.bottom + 8;
    menu.style.top = `${top}px`;
    menu.style.left = `${Math.max(16, Math.min(anchor.left, window.innerWidth - menu.offsetWidth - 16))}px`;
    menu.style.maxHeight = `${Math.max(0, Math.min(620, window.innerHeight - top - 16))}px`;
  }
  picker.addEventListener('toggle', positionMenu);
  window.addEventListener('resize', positionMenu);
  document.addEventListener('click', (event) => {
    if (event.target instanceof Node && !picker.contains(event.target)) picker.open = false;
  });
  picker.addEventListener('focusout', (event) => {
    // Use the destination: activeElement can temporarily be body between focus
    // events, which would close the list before a pointer click reaches a button.
    if (event.relatedTarget instanceof Node && !picker.contains(event.relatedTarget)) picker.open = false;
  });
  picker.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && picker.open) {
      // Closing the picker must not also navigate up a diagram board.
      event.preventDefault();
      event.stopPropagation();
      picker.open = false;
      summary.focus();
    }
  });

  return {
    rememberFile(name: string, source: string) {
      drafts.set(current, readSource());
      // Separate keys preserve files even when they share an example's name.
      const key = `file:${++fileNumber}`;
      addOption(key, name, name, 'Your file · return to your edits', source);
      activate(key, name);
      picker.open = false;
    },
  };
}
