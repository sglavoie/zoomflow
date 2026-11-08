import { examples } from './examples';
import type { Draft } from './draft-store';
import type { createDraftLibrary } from './draft-library';
import type { setupDocumentActions } from './document-actions';
import type { PickerHost } from './example-picker';
import type { PaneId } from './pane-scope';
import { draftRow, projectGroup, type ProjectGroup } from './picker-rows';
import { restoreField } from './field-preference';

const panes: PaneId[] = ['a', 'b'];
const otherPane = (pane: PaneId): PaneId => pane === 'a' ? 'b' : 'a';
type Context = Pick<PickerHost, 'open' | 'forget' | 'checkpoint' | 'focusPane' | 'openAtlas' | 'saveProject'> & {
  picker: HTMLDetailsElement;
  summary: HTMLElement;
  library: ReturnType<typeof createDraftLibrary>;
  actions: ReturnType<typeof setupDocumentActions>;
  target: PaneId;
  split: boolean;
  restoredKey: string | undefined;
  downloadRequested: Record<PaneId, boolean>;
  currentDraft: () => Draft | undefined;
  syncSources: () => void;
  activate: (key: string, pane?: PaneId) => void;
  showTarget: () => void;
};

/** Draft rows, project groups, filtering and removal/restoration from the picker menu. */
export function setupPickerMenu(ctx: Context) {
  const { picker, summary, library, actions, open, forget, checkpoint, focusPane, openAtlas, saveProject,
    downloadRequested, currentDraft, syncSources, activate, showTarget } = ctx;
  const { drafts, current, draftOf, persist, schedulePersist } = library;
  const menu = picker.querySelector<HTMLElement>('.example-menu')!;
  const options = document.querySelector<HTMLElement>('#example-options')!;
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
  restoreField(search, 'zoomflow.diagram-search.v1');
  search.hidden = true;
  const empty = document.createElement('p');
  empty.className = 'example-menu-hint';
  empty.setAttribute('role', 'status');
  empty.hidden = true;
  empty.textContent = 'No matching diagrams. Try a filename or project name.';
  menu.prepend(search);
  fileOptions.after(empty);
  search.addEventListener('input', filterRows);

  function filterRows() {
    const query = search.value.trim().toLocaleLowerCase();
    search.hidden = drafts.size <= 10 && !query;
    let matches = 0;
    const visibleProjects = new Set<string>();
    for (const item of drafts.values()) {
      // Atlas maps open from their project's heading, not from a row.
      if (item.atlasOf) continue;
      const visible = !query || `${item.name} ${item.title} ${item.path ?? ''} ${item.description}`.toLocaleLowerCase().includes(query);
      rows.get(item.key)!.hidden = !visible;
      if (visible) matches++;
      if (visible && item.projectId) visibleProjects.add(item.projectId);
    }
    for (const [id, group] of projectGroups) {
      group.section.hidden = !visibleProjects.has(id);
      if (query) group.files.hidden = false;
      else group.files.hidden = (currentDraft()?.projectId ?? currentDraft()?.atlasOf) !== id;
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
    const removed = [...drafts.values()].filter((draft) => projectId ? draft.projectId === projectId || draft.atlasOf === projectId : draft.key === item.key);
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
    ctx.restoredKey = undefined;
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
    const group = projectGroup(item, () => removeDrafts(item, true), () => {
      picker.open = false;
      summary.focus();
      openAtlas(ctx.target, id);
    }, () => {
      picker.open = false;
      summary.focus();
      saveProject(id);
    });
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
      group.active ||= item.key === current[ctx.target];
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
    if (item.atlasOf) return;
    const { row, button, refresh } = draftRow(item, {
      choose: () => {
        picker.open = false;
        summary.focus();
        if (current[ctx.target] === item.key) return;
        const other = otherPane(ctx.target);
        if (ctx.split && current[other] === item.key) { focusPane(other); return; }
        syncSources();
        activate(item.key);
        schedulePersist();
        open(ctx.target, item);
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
        item.view = undefined;
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
        ctx.restoredKey = item.key;
        actions.offerUndo(`${item.name} restored to the original example.`, () => {
          syncSources();
          Object.assign(item, previous);
          restoreState();
          ctx.restoredKey = undefined;
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

  return { buttons, refreshRows, projectGroups, fileHeading, fileOptions, addOption };
}
