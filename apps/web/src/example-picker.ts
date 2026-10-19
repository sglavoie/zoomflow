import { examples } from './examples';

type Draft = { key: string; name: string; title: string; description: string; source: string; baseline: string; updatedAt?: number };
type SavedDrafts = { current: string; fileNumber: number; drafts: Draft[] };

/** Keep drafts across visits, including distinct uploads with the same filename. */
export function setupExamplePicker(
  readSource: () => string,
  open: (source: string, name: string, key: string, reset?: boolean) => void,
  onState: (dirty: boolean, recoveryAvailable: boolean, savePending: boolean, hasDraft: boolean, downloadRequested: boolean) => void,
  forget: (key: string) => void,
) {
  const picker = document.querySelector<HTMLDetailsElement>('#example-picker')!;
  const summary = picker.querySelector('summary')!;
  const menu = picker.querySelector<HTMLElement>('.example-menu')!;
  const filename = document.querySelector<HTMLElement>('#filename')!;
  const options = document.querySelector<HTMLElement>('#example-options')!;
  const storageKey = 'zoomflow.drafts.v1';
  const drafts = new Map<string, Draft>(examples.map((example) => [example.name, {
    key: example.name, name: example.name, title: example.title, description: example.description,
    source: example.source, baseline: example.source,
  }]));
  const buttons = new Map<string, HTMLButtonElement>();
  const refreshRows = new Map<string, () => void>();
  const fileHeading = document.createElement('h3');
  fileHeading.className = 'example-menu-heading';
  fileHeading.textContent = 'Your drafts';
  const fileOptions = document.createElement('div');
  fileOptions.id = 'draft-options';
  options.after(fileHeading, fileOptions);
  let current = examples[0].name;
  let fileNumber = 0;
  let recoveryAvailable = true;
  let savePending = false;
  let downloadRequested = false;
  let saveTimer: ReturnType<typeof setTimeout> | undefined;

  try {
    const saved: SavedDrafts | null = JSON.parse(localStorage.getItem(storageKey) ?? 'null');
    if (saved && Array.isArray(saved.drafts)) {
      for (const item of saved.drafts) {
        if (!item || typeof item.key !== 'string' || typeof item.name !== 'string' ||
          typeof item.title !== 'string' || typeof item.description !== 'string' ||
          typeof item.source !== 'string' || typeof item.baseline !== 'string') continue;
        if (drafts.has(item.key) || /^file:\d+$/.test(item.key)) drafts.set(item.key, {
          ...item, updatedAt: typeof item.updatedAt === 'number' && Number.isFinite(item.updatedAt) && item.updatedAt > 0
            && item.updatedAt <= 8.64e15 ? item.updatedAt : undefined,
        });
      }
      if (typeof saved.current === 'string' && drafts.has(saved.current)) current = saved.current;
      if (Number.isSafeInteger(saved.fileNumber) && saved.fileNumber >= 0) fileNumber = saved.fileNumber;
      for (const key of drafts.keys()) {
        const match = /^file:(\d+)$/.exec(key);
        if (match) fileNumber = Math.max(fileNumber, Number(match[1]));
      }
    }
  } catch { recoveryAvailable = false; }

  function currentDraft() { return drafts.get(current)!; }
  function announce() {
    const draft = currentDraft();
    const original = examples.find((example) => example.name === draft.key)?.source;
    onState(draft.source !== draft.baseline, recoveryAvailable, savePending,
      draft.key.startsWith('file:') || draft.source !== original || draft.baseline !== original, downloadRequested);
    refreshRows.get(current)?.();
    fileHeading.hidden = fileOptions.childElementCount === 0;
  }
  function persist() {
    clearTimeout(saveTimer);
    savePending = false;
    try {
      const saved: SavedDrafts = { current, fileNumber, drafts: [...drafts.values()].filter((item) =>
        item.key.startsWith('file:') || item.source !== examples.find((example) => example.name === item.key)?.source ||
        item.baseline !== examples.find((example) => example.name === item.key)?.source) };
      localStorage.setItem(storageKey, JSON.stringify(saved));
      recoveryAvailable = true;
    } catch { recoveryAvailable = false; }
    announce();
  }
  function schedulePersist() {
    clearTimeout(saveTimer);
    savePending = true;
    announce();
    saveTimer = setTimeout(persist, 400);
  }
  function activate(key: string) {
    current = key;
    downloadRequested = false;
    filename.textContent = currentDraft().name;
    for (const [id, button] of buttons) {
      if (id === current) button.setAttribute('aria-current', 'true');
      else button.removeAttribute('aria-current');
    }
    announce();
  }

  function addOption(item: Draft) {
    const row = document.createElement('div');
    row.className = 'example-row';
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'example-option';
    const label = document.createElement('span');
    label.className = 'example-title';
    label.textContent = item.title;
    const detail = document.createElement('span');
    detail.className = 'example-description';
    detail.textContent = item.description;
    button.append(label, detail);
    button.addEventListener('click', () => {
      picker.open = false;
      summary.focus();
      if (current === item.key) return;
      currentDraft().source = readSource();
      activate(item.key);
      schedulePersist();
      open(item.source, item.name, item.key);
    });
    row.append(button);
    if (item.key.startsWith('file:')) {
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'example-remove';
      remove.textContent = 'Remove';
      remove.setAttribute('aria-label', `Remove ${item.name} draft`);
      remove.addEventListener('click', (event) => {
        event.stopPropagation();
        if (!window.confirm(`Remove the local draft for ${item.name}? Download a copy first if you want to keep it.`)) return;
        currentDraft().source = readSource();
        drafts.delete(item.key);
        buttons.delete(item.key);
        refreshRows.delete(item.key);
        forget(item.key);
        row.remove();
        summary.focus();
        if (current === item.key) {
          const fallback = examples[0].name;
          activate(fallback);
          picker.open = false;
          open(currentDraft().source, currentDraft().name, current);
        }
        persist();
      });
      row.append(remove);
    } else {
      const restore = document.createElement('button');
      restore.type = 'button';
      restore.className = 'example-restore';
      restore.textContent = 'Restore';
      restore.setAttribute('aria-label', `Restore original example: ${item.title}`);
      restore.addEventListener('click', () => {
        if (!window.confirm(`Restore the original ${item.title} example? This replaces your edits to this example.`)) return;
        const original = examples.find((example) => example.name === item.key)!;
        item.source = original.source;
        item.baseline = original.source;
        item.updatedAt = undefined;
        forget(item.key);
        refreshRows.get(item.key)?.();
        if (current === item.key) {
          downloadRequested = false;
          open(item.source, item.name, item.key, true);
        }
        summary.focus();
        picker.open = false;
        persist();
      });
      row.append(restore);
    }
    const modified = document.createElement('span');
    modified.className = 'example-modified';
    modified.textContent = 'Modified';
    label.append(modified);
    const timestamp = document.createElement('span');
    timestamp.className = 'example-description';
    button.append(timestamp);
    refreshRows.set(item.key, () => {
      const original = examples.find((example) => example.name === item.key)?.source;
      const changed = original !== undefined && item.source !== original;
      modified.hidden = !changed;
      const restore = row.querySelector<HTMLButtonElement>('.example-restore');
      if (restore) restore.hidden = !changed;
      timestamp.hidden = !item.updatedAt;
      timestamp.textContent = item.updatedAt ? `Edited ${new Date(item.updatedAt).toLocaleString()}` : '';
      if (item.key.startsWith('file:')) detail.textContent = `Your file · Draft ${item.key.slice(5)}`;
    });
    refreshRows.get(item.key)!();
    buttons.set(item.key, button);
    (item.key.startsWith('file:') ? fileOptions : options).append(row);
  }

  for (const item of drafts.values()) addOption(item);
  activate(current);
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
    if (event.relatedTarget instanceof Node && !picker.contains(event.relatedTarget)) picker.open = false;
  });
  picker.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && picker.open) {
      event.preventDefault();
      event.stopPropagation();
      picker.open = false;
      summary.focus();
    }
  });

  return {
    initial: { source: currentDraft().source, name: currentDraft().name, key: current },
    updateCurrent(source: string) {
      if (source !== currentDraft().source) currentDraft().updatedAt = Date.now();
      currentDraft().source = source;
      downloadRequested = false;
      schedulePersist();
    },
    markDownloadRequested() {
      currentDraft().source = readSource();
      currentDraft().baseline = currentDraft().source;
      downloadRequested = true;
      persist();
    },
    rememberFile(name: string, source: string) {
      currentDraft().source = readSource();
      const key = `file:${++fileNumber}`;
      const item: Draft = { key, name, title: name, description: 'Your file · return to your edits', source, baseline: source, updatedAt: Date.now() };
      drafts.set(key, item);
      addOption(item);
      activate(key);
      picker.open = false;
      persist();
      return key;
    },
    flush() {
      currentDraft().source = readSource();
      persist();
    },
  };
}
