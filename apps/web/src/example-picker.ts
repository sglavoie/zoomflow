import { examples } from './examples';
import type { Draft } from './draft-store';
import { setupDocumentActions } from './document-actions';
import { createDraftLibrary, isOwnDraft } from './draft-library';
import { draftRow, projectGroup, type ProjectGroup } from './picker-rows';
import { setText } from './text';

import type { PaneId } from './pane-scope';

export type { PaneId };
const panes: PaneId[] = ['a', 'b'];
const otherPane = (pane: PaneId): PaneId => pane === 'a' ? 'b' : 'a';

/** Keep drafts across visits, including distinct uploads with the same filename.
 * Each workspace pane shows one draft; a draft is never open in both panes. The
 * header menu acts on the target pane, and the first pane always has a document.
 */
export type DraftState = {
  dirty: boolean;
  recoveryAvailable: boolean;
  savePending: boolean;
  /** The draft differs from a bundled example, so only the browser or a file keeps it. */
  hasDraft: boolean;
  downloadRequested: boolean;
  identity: { key: string; name: string; projectId?: string };
};

/** What the picker needs from the workspace that shows its drafts. */
export type PickerHost = {
  readSource: (pane: PaneId) => string;
  open: (pane: PaneId, document: { source: string; name: string; key: string } | undefined, reset?: boolean) => void;
  onState: (pane: PaneId, state: DraftState) => void;
  /** Drop per-document editor, viewport and file state for a removed draft. */
  forget: (key: string) => void;
  /** Capture per-document state before removal; the returned function restores it on undo. */
  checkpoint: (key: string) => () => void;
  focusPane: (pane: PaneId) => void;
};

export function setupExamplePicker({ readSource, open, onState, forget, checkpoint, focusPane }: PickerHost) {
  const picker = document.querySelector<HTMLDetailsElement>('#example-picker')!;
  const summary = picker.querySelector('summary')!;
  const menu = picker.querySelector<HTMLElement>('.example-menu')!;
  const filename = document.querySelector<HTMLElement>('#filename')!;
  const options = document.querySelector<HTMLElement>('#example-options')!;
  const actions = setupDocumentActions(() => summary.focus({ preventScroll: true }));
  let restoredKey: string | undefined;
  const library = createDraftLibrary(() => announce());
  const { drafts, current, draftOf, persist, schedulePersist } = library;
  const buttons = new Map<string, HTMLButtonElement>();
  const rows = new Map<string, HTMLElement>();
  const refreshRows = new Map<string, () => void>();
  const projectGroups = new Map<string, ProjectGroup>();
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
  let target: PaneId = 'a';
  let split = false;
  const downloadRequested: Record<PaneId, boolean> = { a: false, b: false };
  /** Opening a file or project may reuse a draft without unsaved changes that the other pane is not showing. */
  function reusable(item: Draft) {
    return item.source === item.baseline && !(split && [...drafts.values()].some((other) =>
      other.key === current[otherPane(target)] && (other.key === item.key || item.projectId && other.projectId === item.projectId)));
  }
  function currentDraft() { return draftOf(target); }
  function syncSources() {
    for (const pane of panes) { const draft = draftOf(pane); if (draft) draft.source = readSource(pane); }
  }
  function announce() {
    for (const pane of panes) {
      const draft = draftOf(pane);
      if (!draft) continue;
      onState(pane, { dirty: draft.source !== draft.baseline, recoveryAvailable: library.recoveryAvailable,
        savePending: library.savePending, hasDraft: isOwnDraft(draft),
        downloadRequested: downloadRequested[pane], identity: draft });
      refreshRows.get(draft.key)?.();
    }
    if (projectGroups.size) {
      const unsaved = new Map<string, number>();
      for (const item of drafts.values()) {
        if (item.projectId && item.source !== item.baseline) unsaved.set(item.projectId, (unsaved.get(item.projectId) ?? 0) + 1);
      }
      for (const [id, group] of projectGroups) {
        const count = unsaved.get(id) ?? 0;
        const indicator = group.section.querySelector<HTMLElement>('.project-unsaved')!;
        setText(indicator, `${count} unsaved`);
        indicator.hidden = count === 0;
      }
    }
    fileHeading.hidden = fileOptions.childElementCount === 0;
  }
  function activate(key: string, pane = target) {
    current[pane] = key;
    downloadRequested[pane] = false;
    showTarget();
  }
  function showTarget() {
    const draft = currentDraft();
    filename.textContent = draft?.name ?? 'Choose a diagram';
    filename.title = draft?.title ?? 'Choose a diagram for this pane';
    const elsewhere = split ? current[otherPane(target)] : undefined;
    for (const [id, button] of buttons) {
      if (id === current[target]) button.setAttribute('aria-current', 'true');
      else button.removeAttribute('aria-current');
      button.querySelector<HTMLElement>('.example-elsewhere')!.hidden = id !== elsewhere;
    }
    announce();
  }

  function filterRows() {
    const query = search.value.trim().toLocaleLowerCase();
    search.hidden = drafts.size <= 10 && !query;
    let matches = 0;
    const visibleProjects = new Set<string>();
    for (const item of drafts.values()) {
      const visible = !query || `${item.name} ${item.title} ${item.path ?? ''} ${item.description}`.toLocaleLowerCase().includes(query);
      rows.get(item.key)!.hidden = !visible;
      if (visible) matches++;
      if (visible && item.projectId) visibleProjects.add(item.projectId);
    }
    for (const [id, group] of projectGroups) {
      group.section.hidden = !visibleProjects.has(id);
      if (query) group.files.hidden = false;
      else group.files.hidden = currentDraft()?.projectId !== id;
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
    syncSources();
    const removed = [...drafts.values()].filter((draft) => projectId ? draft.projectId === projectId : draft.key === item.key);
    const unsaved = removed.filter(draft => draft.source !== draft.baseline).length;
    const name = projectId ? item.title.split('/')[0] : item.name;
    if (!await actions.confirm(`Remove ${name}?`,
      `This removes ${removed.length === 1 ? 'this browser draft' : `all ${removed.length} browser drafts in this project`}. ${unsaved ? `${unsaved} ${unsaved === 1 ? 'file has' : 'files have'} unsaved changes. ` : ''}Files on disk are kept. You can undo for 30 seconds.`,
      projectId ? 'Remove project' : 'Remove draft')) { picker.open = true; return; }
    const previous = { ...current };
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
    for (const pane of panes) {
      if (!removed.some((draft) => draft.key === current[pane])) continue;
      picker.open = false;
      // The second pane may stay empty; the first falls back to an example the second is not showing.
      if (pane === 'b') { current.b = undefined; showTarget(); open('b', undefined); continue; }
      activate(examples.find((example) => example.name !== current.b)!.name, 'a');
      open('a', draftOf('a'));
    }
    persist();
    restoredKey = undefined;
    actions.offerUndo(`${name} removed.`, () => {
      syncSources();
      removed.forEach((draft, index) => { drafts.set(draft.key, draft); restore[index](); addOption(draft); });
      for (const pane of panes) {
        if (!removed.some(draft => draft.key === previous[pane]) || current[otherPane(pane)] === previous[pane]) continue;
        activate(previous[pane]!, pane);
        open(pane, draftOf(pane));
      }
      orderDrafts();
      persist();
    });
  }

  function projectFiles(item: Draft) {
    const id = item.projectId!;
    const existing = projectGroups.get(id);
    if (existing) return existing.files;
    const group = projectGroup(item, () => removeDrafts(item, true));
    fileOptions.append(group.section);
    projectGroups.set(id, group);
    return group.files;
  }

  // Reorder only when opening the menu so typing and keyboard focus stay stable.
  function orderDrafts() {
    const entries = [...drafts.values()].filter((item) => item.projectId || item.key.startsWith('file:'));
    const groups = new Map<string, { node: HTMLElement; active: boolean; updatedAt: number }>();
    for (const item of entries) {
      const key = item.projectId ?? item.key;
      const group = groups.get(key) ?? { node: item.projectId ? projectGroups.get(item.projectId)!.section : rows.get(item.key)!, active: false, updatedAt: 0 };
      group.active ||= item.key === current[target];
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
    const { row, button, refresh } = draftRow(item, {
      choose: () => {
        picker.open = false;
        summary.focus();
        if (current[target] === item.key) return;
        const other = otherPane(target);
        if (split && current[other] === item.key) { focusPane(other); return; }
        syncSources();
        activate(item.key);
        schedulePersist();
        open(target, item);
      },
      remove: () => removeDrafts(item),
      restore: async () => {
        syncSources();
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
        const showing = panes.find((pane) => current[pane] === item.key);
        if (showing) {
          downloadRequested[showing] = false;
          open(showing, item, true);
        }
        summary.focus();
        picker.open = false;
        persist();
        restoredKey = item.key;
        actions.offerUndo(`${item.name} restored to the original example.`, () => {
          syncSources();
          Object.assign(item, previous);
          restoreState();
          restoredKey = undefined;
          refreshRows.get(item.key)?.();
          const showing = panes.find((pane) => current[pane] === item.key);
          if (showing) open(showing, item);
          persist();
        });
      },
    });
    rows.set(item.key, row);
    refreshRows.set(item.key, refresh);
    buttons.set(item.key, button);
    (item.projectId ? projectFiles(item) : item.key.startsWith('file:') ? fileOptions : options).append(row);
  }

  for (const item of drafts.values()) addOption(item);
  activate(current.a!, 'a');
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
    initial: { source: draftOf('a')!.source, name: draftOf('a')!.name, key: current.a! },
    /** Show the second pane: it reopens the draft it showed before a reload, or starts empty. */
    setSplit(value: boolean) {
      if (value === split) return;
      split = value;
      syncSources();
      const stored = library.takeStoredSecond();
      if (split && stored && drafts.has(stored) && stored !== current.a) current.b = stored;
      if (!split) { current.b = undefined; target = 'a'; }
      showTarget();
      persist();
      if (split && current.b) open('b', draftOf('b'));
    },
    /** Direct the header menu, file commands and status to the pane being worked in. */
    setTarget(pane: PaneId) {
      if (pane === target) return;
      target = pane;
      showTarget();
    },
    choose(pane: PaneId) {
      this.setTarget(pane);
      picker.open = true;
      summary.focus();
    },
    currentKey(pane: PaneId) { return current[pane]; },
    projectName(pane: PaneId) { const draft = draftOf(pane); return draft?.projectId ? draft.title.split('/')[0] : undefined; },
    inputPath: library.inputPath,
    compilation: library.compilation,
    /** Open another file of the pane's project, or report the pane already showing it. */
    selectProjectPath(pane: PaneId, path: string) {
      const projectId = draftOf(pane)?.projectId;
      const file = [...drafts.values()].find((item) => item.projectId === projectId && item.path === path && !item.recoveredFrom);
      if (!file) return;
      if (current[otherPane(pane)] === file.key) return { pane: otherPane(pane), source: file.source, name: file.name, key: file.key };
      syncSources();
      activate(file.key, pane);
      schedulePersist();
      return { pane, source: file.source, name: file.name, key: file.key };
    },
    refresh() { announce(); },
    confirm: actions.confirm,
    updateCurrent(pane: PaneId, source: string) {
      const draft = draftOf(pane);
      if (!draft) return;
      if (restoredKey === draft.key && source !== draft.source) { actions.expire(); restoredKey = undefined; }
      if (source !== draft.source) draft.updatedAt = Date.now();
      draft.source = source;
      downloadRequested[pane] = false;
      schedulePersist();
    },
    markDownloadRequested(pane: PaneId) {
      syncSources();
      downloadRequested[pane] = true;
      persist();
    },
    markDiskSaved(key: string, source: string, name: string) {
      let draft = drafts.get(key);
      if (!draft) return;
      const pane = panes.find((id) => current[id] === key);
      if (pane) { draft.source = readSource(pane); downloadRequested[pane] = false; }
      // Saving a built-in example creates a named file without taking over the template.
      const template = examples.find((example) => example.name === key);
      if (template) {
        const example = draft;
        draft = { ...draft, key: `file:${crypto.randomUUID()}`, number: library.nextNumber(), template: template.title,
          name, title: name, updatedAt: Date.now() };
        // The edits moved to the saved copy with their undo history; the example is unedited again.
        example.source = example.baseline;
        example.updatedAt = undefined;
        refreshRows.get(example.key)?.();
        drafts.set(draft.key, draft);
        addOption(draft);
      } else {
        draft.name = name;
        if (!draft.projectId) draft.title = name;
      }
      draft.baseline = source;
      refreshRows.get(draft.key)?.();
      if (pane) activate(draft.key, pane);
      persist();
      return { key: draft.key, name: draft.name };
    },
    /** `match` tells whether a draft is the file being opened (undefined: compare name and contents);
     * without it, the file always becomes a new draft. A matching draft without unsaved changes is reused. */
    rememberFile(name: string, source: string, baseline = source, match?: (key: string) => boolean | undefined) {
      syncSources();
      const existing = match && [...drafts.values()].find((item) => item.key.startsWith('file:') && reusable(item) &&
        (match(item.key) ?? (item.name === name && item.baseline === baseline && item.source === source)));
      if (existing) {
        Object.assign(existing, { name, title: name, source, baseline, updatedAt: Date.now() });
        refreshRows.get(existing.key)?.();
        activate(existing.key);
        picker.open = false;
        persist();
        return existing.key;
      }
      const key = `file:${crypto.randomUUID()}`;
      const number = library.nextNumber();
      const item: Draft = { key, number, name, title: name, description: 'Your file · return to your edits', source, baseline, updatedAt: Date.now() };
      drafts.set(key, item);
      addOption(item);
      activate(key);
      picker.open = false;
      persist();
      return key;
    },
    /** Reopening an unchanged project reuses its drafts; see `rememberFile` for `match`. */
    rememberFolder(folderName: string, files: { path: string; source: string }[], match: (key: string) => boolean | undefined = () => undefined) {
      syncSources();
      const sources = new Map(files.map((file) => [file.path, file.source]));
      const project = [...projectGroups.keys()].find((id) => {
        const members = [...drafts.values()].filter((item) => item.projectId === id);
        return members.length === files.length && members.every((item) => !item.recoveredFrom && reusable(item) &&
          item.title === `${folderName}/${item.path}` && sources.has(item.path!) && (match(item.key) ?? item.baseline === sources.get(item.path!)));
      });
      const projectId = project ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
      const keys: Record<string, string> = Object.create(null);
      for (const file of files) {
        const key = `project:${projectId}:${file.path}`;
        const reused = project ? drafts.get(key) : undefined;
        if (reused) {
          Object.assign(reused, { source: file.source, baseline: file.source, updatedAt: Date.now() });
          keys[file.path] = key;
          refreshRows.get(key)?.();
          continue;
        }
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
      syncSources();
      persist();
    },
  };
}
