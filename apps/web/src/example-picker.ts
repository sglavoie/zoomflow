import { examples } from './examples';
import { DraftStore, type Draft } from './draft-store';
import { setupDocumentActions } from './document-actions';

/** Keep drafts across visits, including distinct uploads with the same filename. */
export function setupExamplePicker(
  readSource: () => string,
  open: (source: string, name: string, key: string, reset?: boolean) => void,
  onState: (dirty: boolean, recoveryAvailable: boolean, savePending: boolean, hasDraft: boolean, downloadRequested: boolean, identity: { key: string; name: string }) => void,
  forget: (key: string) => void,
  checkpoint: (key: string) => () => void,
) {
  const picker = document.querySelector<HTMLDetailsElement>('#example-picker')!;
  const summary = picker.querySelector('summary')!;
  const menu = picker.querySelector<HTMLElement>('.example-menu')!;
  const filename = document.querySelector<HTMLElement>('#filename')!;
  const options = document.querySelector<HTMLElement>('#example-options')!;
  const actions = setupDocumentActions(() => summary.focus({ preventScroll: true }));
  let restoredKey: string | undefined;
  let store: DraftStore | undefined;
  const conflictNotice = document.querySelector<HTMLElement>('#draft-conflict')!;
  const drafts = new Map<string, Draft>(examples.map((example) => [example.name, {
    key: example.name, name: example.name, title: example.title, description: example.description,
    source: example.source, baseline: example.source,
  }]));
  const buttons = new Map<string, HTMLButtonElement>();
  const rows = new Map<string, HTMLElement>();
  const refreshRows = new Map<string, () => void>();
  const projectGroups = new Map<string, { section: HTMLElement; files: HTMLElement; toggle: HTMLButtonElement }>();
  const fileHeading = document.createElement('h3');
  fileHeading.className = 'example-menu-heading';
  fileHeading.textContent = 'Your drafts';
  const fileOptions = document.createElement('div');
  fileOptions.id = 'draft-options';
  menu.prepend(fileHeading, fileOptions);
  const search = document.createElement('input');
  search.type = 'search';
  search.id = 'diagram-search';
  search.placeholder = 'Find a diagram or project…';
  search.setAttribute('aria-label', 'Find a diagram or project');
  search.hidden = true;
  const empty = document.createElement('p');
  empty.className = 'example-menu-hint';
  empty.setAttribute('role', 'status');
  empty.hidden = true;
  empty.textContent = 'No matching diagrams. Try a filename or project name.';
  menu.prepend(search);
  fileOptions.after(empty);
  search.addEventListener('input', filterRows);
  let current = examples[0].name;
  let fileNumber = 0;
  let recoveryAvailable = true;
  let savePending = false;
  let downloadRequested = false;
  let saveTimer: ReturnType<typeof setTimeout> | undefined;

  try {
    store = new DraftStore(localStorage);
    const saved = store.load();
    recoveryAvailable = saved.recoveryAvailable;
    for (const item of saved.drafts) {
      drafts.set(item.key, item);
      fileNumber = Math.max(fileNumber, item.number ?? (/^file:\d+$/.test(item.key) ? Number(item.key.slice(5)) : 0));
    }
    const numbers = new Set<number>();
    for (const item of drafts.values()) {
      if (!item.key.startsWith('file:') || item.recoveredFrom) continue;
      let number = item.number ?? Number(item.key.slice(5));
      if (!Number.isSafeInteger(number) || number < 1 || numbers.has(number)) number = ++fileNumber;
      item.number = number;
      numbers.add(number);
    }
    if (saved.current && drafts.has(saved.current)) current = saved.current;
  } catch { recoveryAvailable = false; }
  function checkConflicts() {
    try { conflictNotice.hidden = !store?.hasConcurrentChanges(); }
    catch { /* Saving reports storage failures beside the save control. */ }
  }
  window.addEventListener('storage', (event) => {
    if (DraftStore.isDraftEvent(event.key)) checkConflicts();
  });

  function currentDraft() { return drafts.get(current)!; }
  function announce() {
    const draft = currentDraft();
    const original = examples.find((example) => example.name === draft.key)?.source;
    onState(draft.source !== draft.baseline, recoveryAvailable, savePending,
      draft.key.startsWith('file:') || Boolean(draft.projectId) || draft.source !== original || draft.baseline !== original, downloadRequested, draft);
    refreshRows.get(current)?.();
    for (const [id, group] of projectGroups) {
      const count = [...drafts.values()].filter((item) => item.projectId === id && item.source !== item.baseline).length;
      const indicator = group.section.querySelector<HTMLElement>('.project-unsaved')!;
      indicator.textContent = `${count} unsaved`;
      indicator.hidden = count === 0;
    }
    fileHeading.hidden = fileOptions.childElementCount === 0;
  }
  function persist() {
    clearTimeout(saveTimer);
    savePending = false;
    try {
      if (!store) store = new DraftStore(localStorage);
      store.save([...drafts.values()].filter((item) => item.key.startsWith('file:') || Boolean(item.projectId) ||
        item.source !== examples.find((example) => example.name === item.key)?.source ||
        item.baseline !== examples.find((example) => example.name === item.key)?.source), current);
      checkConflicts();
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
    filename.title = currentDraft().title;
    for (const [id, button] of buttons) {
      if (id === current) button.setAttribute('aria-current', 'true');
      else button.removeAttribute('aria-current');
    }
    announce();
  }

  function filterRows() {
    const query = search.value.trim().toLocaleLowerCase();
    search.hidden = drafts.size <= 10 && !query;
    let matches = 0;
    for (const item of drafts.values()) {
      const visible = !query || `${item.name} ${item.title} ${item.path ?? ''} ${item.description}`.toLocaleLowerCase().includes(query);
      rows.get(item.key)!.hidden = !visible;
      if (visible) matches++;
    }
    for (const [id, group] of projectGroups) {
      const visible = [...drafts.values()].some(item => item.projectId === id && !rows.get(item.key)!.hidden);
      group.section.hidden = !visible;
      if (query) group.files.hidden = false;
      else group.files.hidden = currentDraft().projectId !== id;
      group.toggle.setAttribute('aria-expanded', String(!group.files.hidden));
    }
    fileHeading.hidden = ![...fileOptions.children].some(node => !(node as HTMLElement).hidden);
    options.hidden = ![...options.children].some(node => !(node as HTMLElement).hidden);
    const heading = menu.querySelector<HTMLElement>('.example-menu-heading:not(h3)');
    if (heading) heading.hidden = options.hidden;
    menu.querySelector<HTMLElement>('.example-menu-hint:not([role])')!.hidden = Boolean(query);
    empty.hidden = matches !== 0;
  }

  async function removeDrafts(item: Draft, wholeProject = Boolean(item.projectId && !item.recoveredFrom)) {
    const projectId = wholeProject ? item.projectId : undefined;
    currentDraft().source = readSource();
    const removed = [...drafts.values()].filter((draft) => projectId ? draft.projectId === projectId : draft.key === item.key);
    const unsaved = removed.filter(draft => draft.source !== draft.baseline).length;
    const name = projectId ? item.title.split('/')[0] : item.name;
    if (!await actions.confirm(`Remove ${name}?`,
      `This removes ${removed.length === 1 ? 'this browser draft' : `all ${removed.length} browser drafts in this project`}. ${unsaved ? `${unsaved} ${unsaved === 1 ? 'file has' : 'files have'} unsaved changes. ` : ''}Files on disk are kept. You can undo for 30 seconds.`,
      projectId ? 'Remove project' : 'Remove draft')) { picker.open = true; return; }
    const previous = current;
    const restore = removed.map(draft => checkpoint(draft.key));
    for (const draft of removed) {
      drafts.delete(draft.key);
      buttons.delete(draft.key);
      refreshRows.delete(draft.key);
      rows.get(draft.key)?.remove();
      rows.delete(draft.key);
      forget(draft.key);
    }
    if (projectId) {
      projectGroups.get(projectId)?.section.remove();
      projectGroups.delete(projectId);
    }
    summary.focus();
    if (removed.some((draft) => draft.key === current)) {
      activate(examples[0].name);
      picker.open = false;
      open(currentDraft().source, currentDraft().name, current);
    }
    persist();
    restoredKey = undefined;
    actions.offerUndo(`${name} removed.`, () => {
      currentDraft().source = readSource();
      removed.forEach((draft, index) => { drafts.set(draft.key, draft); restore[index](); addOption(draft); });
      if (removed.some(draft => draft.key === previous)) {
        activate(previous);
        open(currentDraft().source, currentDraft().name, current);
      }
      orderDrafts();
      persist();
    });
  }

  function projectFiles(item: Draft) {
    const id = item.projectId!;
    const existing = projectGroups.get(id);
    if (existing) return existing.files;
    const section = document.createElement('section');
    section.className = 'project-group';
    const name = item.title.split('/')[0];
    section.setAttribute('aria-label', `${name} project`);
    const heading = document.createElement('div');
    heading.className = 'project-heading';
    const title = document.createElement('button');
    title.type = 'button';
    title.className = 'project-toggle button-quiet';
    title.textContent = name;
    title.setAttribute('aria-label', name);
    title.setAttribute('aria-expanded', 'true');
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'example-remove button-quiet';
    remove.textContent = 'Remove project';
    remove.setAttribute('aria-label', `Remove ${name} project drafts`);
    remove.addEventListener('click', () => removeDrafts(item, true));
    const unsaved = document.createElement('span');
    unsaved.className = 'project-unsaved';
    unsaved.setAttribute('role', 'status');
    heading.append(title, unsaved, remove);
    const files = document.createElement('div');
    files.id = `project-files-${id}`;
    title.setAttribute('aria-controls', files.id);
    title.addEventListener('click', () => {
      files.hidden = !files.hidden;
      title.setAttribute('aria-expanded', String(!files.hidden));
    });
    section.append(heading, files);
    fileOptions.append(section);
    projectGroups.set(id, { section, files, toggle: title });
    return files;
  }

  // Reorder only when opening the menu so typing and keyboard focus stay stable.
  function orderDrafts() {
    const entries = [...drafts.values()].filter((item) => item.projectId || item.key.startsWith('file:'));
    const groups = new Map<string, { node: HTMLElement; active: boolean; updatedAt: number }>();
    for (const item of entries) {
      const key = item.projectId ?? item.key;
      const group = groups.get(key) ?? { node: item.projectId ? projectGroups.get(item.projectId)!.section : rows.get(item.key)!, active: false, updatedAt: 0 };
      group.active ||= item.key === current;
      group.updatedAt = Math.max(group.updatedAt, item.updatedAt ?? 0);
      groups.set(key, group);
    }
    for (const group of [...groups.values()].sort((a, b) => Number(b.active) - Number(a.active) || b.updatedAt - a.updatedAt)) fileOptions.append(group.node);
    for (const [id, group] of projectGroups) {
      for (const item of entries.filter((draft) => draft.projectId === id).sort((a, b) => a.path!.localeCompare(b.path!))) group.files.append(rows.get(item.key)!);
    }
    filterRows();
  }

  function addOption(item: Draft) {
    const row = document.createElement('div');
    row.className = 'example-row';
    rows.set(item.key, row);
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'example-option';
    const label = document.createElement('span');
    label.className = 'example-title';
    label.textContent = item.projectId ? `${item.path}${item.recoveredFrom ? ' (recovered)' : ''}` : item.title;
    if (item.projectId) button.title = item.title;
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
      remove.className = 'example-remove button-quiet';
      remove.textContent = 'Remove';
      remove.setAttribute('aria-label', `Remove ${item.name} draft`);
      remove.addEventListener('click', (event) => {
        event.stopPropagation();
        removeDrafts(item);
      });
      row.append(remove);
    } else if (!item.projectId) {
      const restore = document.createElement('button');
      restore.type = 'button';
      restore.className = 'example-restore';
      restore.textContent = 'Restore';
      restore.setAttribute('aria-label', `Restore original example: ${item.title}`);
      restore.addEventListener('click', async () => {
        currentDraft().source = readSource();
        if (!await actions.confirm(`Restore ${item.title}?`,
          `Replace your edits to ${item.name} with the original example. ${item.source !== item.baseline ? 'This example has unsaved changes. ' : ''}Saved file copies are kept. You can undo for 30 seconds, until you edit this example again.`, 'Restore example')) { picker.open = true; return; }
        const previous = { ...item };
        const restoreState = checkpoint(item.key);
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
        restoredKey = item.key;
        actions.offerUndo(`${item.name} restored to the original example.`, () => {
          currentDraft().source = readSource();
          Object.assign(item, previous);
          restoreState();
          restoredKey = undefined;
          refreshRows.get(item.key)?.();
          if (current === item.key) open(item.source, item.name, item.key);
          persist();
        });
      });
      row.append(restore);
    }
    const modified = document.createElement('span');
    modified.className = 'example-modified';
    modified.textContent = 'Modified';
    label.append(modified);
    const unsaved = document.createElement('span');
    unsaved.className = 'draft-unsaved';
    unsaved.textContent = '•';
    unsaved.setAttribute('role', 'img');
    unsaved.setAttribute('aria-label', 'Unsaved changes');
    unsaved.title = 'Changes since the last file save';
    label.append(unsaved);
    const timestamp = document.createElement('span');
    timestamp.className = 'example-description';
    button.append(timestamp);
    refreshRows.set(item.key, () => {
      label.firstChild!.textContent = item.projectId
        ? `${item.path}${item.name !== item.path!.split('/').at(-1) ? ` → ${item.name}` : ''}${item.recoveredFrom ? ' (recovered)' : ''}` : item.title;
      row.querySelector('.example-remove')?.setAttribute('aria-label', `Remove ${item.name} draft`);
      const original = examples.find((example) => example.name === item.key)?.source;
      const changed = original !== undefined && item.source !== original;
      modified.hidden = !changed;
      unsaved.hidden = original !== undefined || item.source === item.baseline;
      const restore = row.querySelector<HTMLButtonElement>('.example-restore');
      if (restore) restore.hidden = !changed;
      timestamp.hidden = !item.updatedAt || Boolean(item.projectId);
      timestamp.textContent = item.updatedAt ? `Edited ${new Date(item.updatedAt).toLocaleDateString()}` : '';
      button.title = item.projectId ? item.title : [item.title, item.updatedAt ? `Edited ${new Date(item.updatedAt).toLocaleString()}` : ''].filter(Boolean).join('\n');
      if (item.recoveredFrom) detail.textContent = 'Recovered copy · Edits from another tab';
      else if (item.key.startsWith('file:')) detail.textContent = item.template ? `Saved copy of ${item.template} · Draft ${item.number}` : `Your file · Draft ${item.number ?? item.key.slice(5)}`;
      else if (item.projectId) { detail.textContent = ''; detail.hidden = true; }
    });
    refreshRows.get(item.key)!();
    buttons.set(item.key, button);
    (item.projectId ? projectFiles(item) : item.key.startsWith('file:') ? fileOptions : options).append(row);
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
  picker.addEventListener('toggle', () => { if (picker.open) orderDrafts(); positionMenu(); });
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
    get currentKey() { return current; },
    get projectName() { return currentDraft().projectId ? currentDraft().title.split('/')[0] : undefined; },
    compilation() {
      const draft = currentDraft();
      if (!draft.projectId || !draft.path) return { inputPath: 'index', fs: { index: draft.source } };
      const fs: Record<string, string> = Object.create(null);
      for (const item of drafts.values()) if (item.projectId === draft.projectId && item.path && !item.recoveredFrom) fs[item.path] = item.source;
      fs[draft.path] = draft.source;
      return { inputPath: draft.path, fs };
    },
    hasProjectPath(path: string) {
      const projectId = currentDraft().projectId;
      return Boolean(projectId && [...drafts.values()].some((item) => item.projectId === projectId && item.path === path));
    },
    selectProjectPath(path: string) {
      const projectId = currentDraft().projectId;
      const target = [...drafts.values()].find((item) => item.projectId === projectId && item.path === path && !item.recoveredFrom);
      if (!target) return;
      currentDraft().source = readSource();
      activate(target.key);
      schedulePersist();
      return { source: target.source, name: target.name, key: target.key };
    },
    refresh() { announce(); },
    updateCurrent(source: string) {
      if (restoredKey === current && source !== currentDraft().source) { actions.expire(); restoredKey = undefined; }
      if (source !== currentDraft().source) currentDraft().updatedAt = Date.now();
      currentDraft().source = source;
      downloadRequested = false;
      schedulePersist();
    },
    markDownloadRequested() {
      currentDraft().source = readSource();
      downloadRequested = true;
      persist();
    },
    markDiskSaved(key: string, source: string, name: string) {
      let draft = drafts.get(key);
      if (!draft) return;
      if (current === key) { draft.source = readSource(); downloadRequested = false; }
      // Saving a built-in example creates a named file without taking over the template.
      const template = examples.find((example) => example.name === key);
      if (template) {
        draft = { ...draft, key: `file:${crypto.randomUUID()}`, number: ++fileNumber, template: template.title,
          name, title: name, updatedAt: Date.now() };
        drafts.set(draft.key, draft);
        addOption(draft);
      } else {
        draft.name = name;
        if (!draft.projectId) draft.title = name;
      }
      draft.baseline = source;
      refreshRows.get(draft.key)?.();
      if (current === key) activate(draft.key);
      persist();
      return { key: draft.key, name: draft.name };
    },
    rememberFile(name: string, source: string, baseline = source) {
      currentDraft().source = readSource();
      const key = `file:${crypto.randomUUID()}`;
      const number = ++fileNumber;
      const item: Draft = { key, number, name, title: name, description: 'Your file · return to your edits', source, baseline, updatedAt: Date.now() };
      drafts.set(key, item);
      addOption(item);
      activate(key);
      picker.open = false;
      persist();
      return key;
    },
    rememberFolder(folderName: string, files: { path: string; source: string }[]) {
      currentDraft().source = readSource();
      const projectId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
      const keys: Record<string, string> = Object.create(null);
      for (const file of files) {
        const key = `project:${projectId}:${file.path}`;
        const name = file.path.split('/').at(-1)!;
        const item: Draft = { key, name, title: `${folderName}/${file.path}`, description: 'Project file',
          source: file.source, baseline: file.source, projectId, path: file.path, updatedAt: Date.now() };
        keys[file.path] = key;
        drafts.set(key, item);
        addOption(item);
      }
      const first = files.find((file) => /^(index|main)\.d2$/i.test(file.path)) ??
        files.find((file) => !file.path.includes('/')) ?? files[0];
      activate(keys[first.path]);
      picker.open = false;
      persist();
      return { key: keys[first.path], name: first.path.split('/').at(-1)!, source: first.source, keys };
    },
    flush() {
      currentDraft().source = readSource();
      persist();
    },
  };
}
