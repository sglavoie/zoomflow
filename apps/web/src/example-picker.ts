import { displayTitle } from './text';
import { examples } from './examples';
import type { Draft } from './draft-store';
import { setupDocumentActions } from './document-actions';
import { createDraftLibrary, exampleSource, isOwnDraft } from './draft-library';
import { flowFilename } from './flow-model';
import { atlasMapName } from './atlas-map';
import { setupPickerMenu } from './picker-menu';
import { plural, safeFilename, setText } from './text';
import type { ProjectArchive } from '@zoomflow/core';
import type { ProjectSaveSnapshot } from './project-save';
import { parseDocumentView, serializeDocumentView, type DocumentView } from '@zoomflow/viewer';

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
  /** Draw a project's atlas map in a pane. */
  openAtlas: (pane: PaneId, projectId: string) => void;
  saveProject: (projectId: string) => void;
};

/** The file a folder project opens at: its home board, index.d2, as an atlas starts there. */
function homePath(paths: string[]) {
  return paths.find((path) => /^index\.d2$/i.test(path)) ?? paths.find((path) => /^main\.d2$/i.test(path)) ??
    paths.find((path) => !path.includes('/')) ?? paths[0];
}

export function setupExamplePicker({ readSource, open, onState, forget, checkpoint, focusPane, openAtlas, saveProject }: PickerHost) {
  const picker = document.querySelector<HTMLDetailsElement>('#example-picker')!;
  const summary = picker.querySelector('summary')!;
  const filename = document.querySelector<HTMLElement>('#filename')!;
  const actions = setupDocumentActions(() => summary.focus({ preventScroll: true }));
  let restoredKey: string | undefined;
  const library = createDraftLibrary(() => announce());
  const { drafts, current, draftOf, persist, schedulePersist } = library;
  let target: PaneId = 'a';
  let split = false;
  const downloadRequested: Record<PaneId, boolean> = { a: false, b: false };
  const { buttons, refreshRows, projectGroups, fileHeading, fileOptions, addOption } = setupPickerMenu({
    picker, summary, library, actions, open, forget, checkpoint, focusPane, openAtlas, saveProject,
    downloadRequested, currentDraft, syncSources, activate, showTarget,
    get target() { return target; },
    get split() { return split; },
    get restoredKey() { return restoredKey; }, set restoredKey(value) { restoredKey = value; },
  });
  // Renaming detaches a file, even when renamed back or when an example becomes a named copy.
  const diskSaveVersions = new Map<string, number>();
  /** Opening a file or project may reuse a draft without unsaved changes that the other pane is not showing. */
  function reusable(item: Draft, pane = target) {
    return item.source === item.baseline && !(split && [...drafts.values()].some((other) =>
      other.key === current[otherPane(pane)] && (other.key === item.key || item.projectId && other.projectId === item.projectId)));
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
      const changedFiles = new Map<string, number>();
      for (const item of drafts.values()) {
        if (item.projectId && item.source !== item.baseline) unsaved.set(item.projectId, (unsaved.get(item.projectId) ?? 0) + 1);
        if (item.projectId && !item.recoveredFrom && item.source !== item.baseline) changedFiles.set(item.projectId, (changedFiles.get(item.projectId) ?? 0) + 1);
      }
      for (const [id, group] of projectGroups) {
        const count = unsaved.get(id) ?? 0;
        const indicator = group.section.querySelector<HTMLElement>('.project-unsaved')!;
        setText(indicator, `${count} unsaved`);
        indicator.hidden = count === 0;
        const changed = changedFiles.get(id) ?? 0;
        setText(group.save, `Save all · ${plural(changed, 'file')}`);
        group.save.disabled = changed === 0;
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
    filename.textContent = draft?.name ?? '';
    document.querySelector('#document-title')!.textContent = draft ? displayTitle(draft.title || draft.name) : 'Choose a diagram';
    filename.title = draft?.title ?? 'Choose a diagram for this pane';
    const elsewhere = split ? current[otherPane(target)] : undefined;
    for (const [id, button] of buttons) {
      if (id === current[target]) button.setAttribute('aria-current', 'true');
      else button.removeAttribute('aria-current');
      button.querySelector<HTMLElement>('.example-elsewhere')!.hidden = id !== elsewhere;
    }
    announce();
  }

  /** A named draft carrying an example's edits; the example is unedited again. */
  function ownCopy(example: Draft, name: string) {
    const draft: Draft = { ...example, key: `file:${crypto.randomUUID()}`, number: library.nextNumber(),
      template: examples.find((item) => item.name === example.key)!.title, name, title: name, updatedAt: Date.now() };
    // The edits move to the copy with their undo history.
    example.source = example.baseline;
    example.updatedAt = undefined;
    refreshRows.get(example.key)?.();
    drafts.set(draft.key, draft);
    addOption(draft);
    return draft;
  }

  for (const item of drafts.values()) addOption(item);
  activate(current.a!, 'a');

  return {
    initial: { source: draftOf('a')!.source, name: draftOf('a')!.name, key: current.a! },
    readView: (key: string) => parseDocumentView(drafts.get(key)?.view),
    writeView(key: string, patch: DocumentView) {
      const draft = drafts.get(key);
      if (!draft || draft.atlasOf) return;
      const view = serializeDocumentView({ ...parseDocumentView(draft.view), ...patch });
      if (draft.view === view) return;
      draft.view = view;
      schedulePersist();
    },
    hasDraft: (key: string) => drafts.has(key),
    hasProject: (projectId: string) => [...drafts.values()].some((item) => item.projectId === projectId),
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
    /** The project whose atlas map the pane shows. */
    atlasProject(pane: PaneId) { return draftOf(pane)?.atlasOf; },
    /** A project's files by path, with their latest edits, and the file it opens at. */
    projectSources(projectId: string) {
      syncSources();
      const fs: Record<string, string> = Object.create(null);
      for (const item of drafts.values()) if (item.projectId === projectId && item.path && !item.recoveredFrom) fs[item.path] = item.source;
      return { fs, home: homePath(Object.keys(fs).sort((a, b) => a.localeCompare(b))) };
    },
    /** Capture every canonical project file, including unlinked files and both panes' current edits.
     * A selected recovered copy replaces only its own path in this backup, never the live project. */
    archiveSnapshot(pane: PaneId): ProjectArchive | undefined {
      syncSources();
      const draft = draftOf(pane);
      if (!draft) return;
      const projectId = draft.projectId ?? draft.atlasOf;
      if (!projectId) {
        const name = safeFilename(draft.name.replace(/\.d2$/i, ''));
        const path = `${name}.d2`;
        return { name, entry: path, files: [{ path, source: draft.source, view: draft.view }] };
      }
      const files = [...drafts.values()].filter(item => item.projectId === projectId && item.path && !item.recoveredFrom)
        .map(item => ({ path: item.path!, source: item.source, view: item.view })).sort((a, b) => a.path.localeCompare(b.path));
      if (draft.recoveredFrom && draft.path) {
        const index = files.findIndex(file => file.path === draft.path);
        const file = { path: draft.path, source: draft.source, view: draft.view };
        if (index < 0) files.push(file); else files[index] = file;
      }
      const entry = draft.path ?? (draft.opener && drafts.get(draft.opener)?.path) ?? homePath(files.map(file => file.path));
      return { name: draft.title.split('/')[0], entry, files };
    },
    /** Capture both panes before saving; recovered copies never overwrite a canonical project file. */
    projectSaveSnapshot(projectId: string): ProjectSaveSnapshot | undefined {
      syncSources();
      const files = [...drafts.values()].filter(item => item.projectId === projectId && item.path && !item.recoveredFrom)
        .sort((a, b) => a.path!.localeCompare(b.path!));
      if (!files.length) return;
      return { id: projectId, name: files[0].title.split('/')[0], files: files.filter(item => item.source !== item.baseline)
        .map(item => ({ key: item.key, path: item.path!, name: item.name, source: item.source })) };
    },
    /** Show a project's atlas map in the pane, drawn from `source`, or as last drawn; or report the other pane showing it.
     * A map is never saved: a reload shows the project file the pane showed before it. */
    showAtlas(pane: PaneId, projectId: string, source?: string) {
      const key = `atlas:${projectId}`;
      const existing = drafts.get(key);
      source ??= existing?.source;
      if (source === undefined) return;
      syncSources();
      const from = draftOf(pane);
      const opener = from?.projectId === projectId && !from.recoveredFrom ? from.key : from?.atlasOf === projectId ? from.opener
        : existing?.opener ?? [...drafts.values()].find((item) => item.projectId === projectId && !item.recoveredFrom)?.key;
      const project = opener && drafts.get(opener);
      if (!project) return;
      const atlas: Draft = Object.assign(existing ?? { key, name: atlasMapName, description: 'Generated from the project files · read-only' },
        { title: `${project.title.split('/')[0]}/${atlasMapName}`, source, baseline: source, atlasOf: projectId, opener });
      drafts.set(key, atlas);
      if (split && current[otherPane(pane)] === key) return { pane: otherPane(pane), source, name: atlas.name, key };
      activate(key, pane);
      schedulePersist();
      return { pane, source, name: atlas.name, key };
    },
    inputPath: library.inputPath,
    compilation: library.compilation,
    /** Open another file of the pane's project, or report the pane already showing it. `key` prefers that draft of
     * the project, such as a recovered copy, while it still exists. */
    selectProjectPath(pane: PaneId, path: string, key?: string) {
      const projectId = draftOf(pane)?.projectId ?? draftOf(pane)?.atlasOf;
      const chosen = key === undefined ? undefined : drafts.get(key);
      const file = chosen?.projectId === projectId && chosen?.path !== undefined ? chosen
        : [...drafts.values()].find((item) => item.projectId === projectId && item.path === path && !item.recoveredFrom);
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
    diskSaveVersion(key: string) { return diskSaveVersions.get(key) ?? 0; },
    markDiskSaved(key: string, source: string, name: string, version: number) {
      let draft = drafts.get(key);
      // A rename detaches the old disk file. A save already writing that file must not undo it.
      if (!draft || (diskSaveVersions.get(key) ?? 0) !== version) return;
      const pane = panes.find((id) => current[id] === key);
      if (pane) { draft.source = readSource(pane); downloadRequested[pane] = false; }
      // Saving a built-in example creates a named file without taking over the template.
      if (exampleSource(key) !== undefined) draft = ownCopy(draft, name);
      else {
        draft.name = name;
        if (!draft.projectId) draft.title = name;
      }
      draft.baseline = source;
      refreshRows.get(draft.key)?.();
      if (pane) activate(draft.key, pane);
      persist();
      return { key: draft.key, name: draft.name };
    },
    /** Name the pane's draft, which names its exports and downloads; project files keep their path.
     * Renaming a built-in example moves its edits to a new draft with that name, as saving one does. */
    rename(pane: PaneId, name: string) {
      let draft = draftOf(pane);
      if (!draft || draft.projectId || draft.atlasOf) return;
      // A blank name keeps the current one, and so does a field left as shown: `Diagram.D2` shows as `Diagram`.
      const current = draft.name.replace(/\.d2$/i, '');
      name = flowFilename(name, current);
      if (name === flowFilename(draft.name, current)) return;
      diskSaveVersions.set(draft.key, (diskSaveVersions.get(draft.key) ?? 0) + 1);
      draft.source = readSource(pane);
      if (exampleSource(draft.key) !== undefined) {
        // The copy is not on disk yet, so all of its source counts as unsaved.
        draft = ownCopy(draft, name);
        draft.baseline = '';
        downloadRequested[pane] = false;
      } else Object.assign(draft, { name, title: name });
      refreshRows.get(draft.key)?.();
      activate(draft.key, pane);
      persist();
      return { key: draft.key, name: draft.name };
    },
    /** `match` tells whether a draft is the file being opened (undefined: compare name and contents);
     * without it, the file always becomes a new draft. A matching draft without unsaved changes is reused. */
    rememberFile(name: string, source: string, baseline = source, match?: (key: string) => boolean | undefined, pane = target) {
      syncSources();
      const existing = match && [...drafts.values()].find((item) => item.key.startsWith('file:') && !item.recoveredFrom && !item.projectId && reusable(item, pane) &&
        (match(item.key) ?? (item.name === name && item.baseline === baseline && item.source === source)));
      if (existing) {
        Object.assign(existing, { name, title: name, source, baseline, updatedAt: Date.now() });
        refreshRows.get(existing.key)?.();
        activate(existing.key, pane);
        picker.open = false;
        persist();
        return existing.key;
      }
      const key = `file:${crypto.randomUUID()}`;
      const number = library.nextNumber();
      const item: Draft = { key, number, name, title: name, description: 'Your file · return to your edits', source, baseline, updatedAt: Date.now() };
      drafts.set(key, item);
      addOption(item);
      activate(key, pane);
      picker.open = false;
      persist();
      return key;
    },
    /** Reopening an unchanged project reuses its drafts; see `rememberFile` for `match`. An unsaved project, such as
     * a draft atlas in a browser that cannot write to folders, is not on disk, so all of its source counts as unsaved. */
    rememberFolder(folderName: string, files: { path: string; source: string; view?: string }[], match: (key: string) => boolean | undefined = () => undefined,
      saved = true, pane = target, entry?: string) {
      syncSources();
      const sources = new Map(files.map((file) => [file.path, file.source]));
      const project = saved ? [...projectGroups.keys()].find((id) => {
        const members = [...drafts.values()].filter((item) => item.projectId === id);
        return members.length === files.length && members.every((item) => !item.recoveredFrom && reusable(item, pane) &&
          item.title === `${folderName}/${item.path}` && sources.has(item.path!) && (match(item.key) ?? item.baseline === sources.get(item.path!)));
      }) : undefined;
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
          source: file.source, baseline: saved ? file.source : '', projectId, path: file.path, updatedAt: Date.now(), view: file.view };
        keys[file.path] = key;
        drafts.set(key, item);
        addOption(item);
      }
      const home = entry ?? homePath(files.map((file) => file.path));
      const first = files.find((file) => file.path === home)!;
      activate(keys[first.path], pane);
      picker.open = false;
      persist();
      return { key: keys[first.path], name: first.path.split('/').at(-1)!, source: first.source, keys, projectId };
    },
    /** Archives always open as independent copies without file or directory write handles. */
    rememberArchive(project: ProjectArchive, pane = target) {
      const files = project.files.map(file => ({ ...file, view: serializeDocumentView(parseDocumentView(file.view)) }));
      return this.rememberFolder(project.name, files, () => false, true, pane, project.entry);
    },
    /** Add a new file to its requested project, even if its pane switched during the write. `saved` when it is
     * on disk already, otherwise Save asks where to put it. A removed project stays removed. */
    addProjectFile(projectId: string, path: string, source: string, saved: boolean) {
      const draft = [...drafts.values()].find(item => item.projectId === projectId && !item.recoveredFrom);
      if (!draft) return;
      const key = `project:${projectId}:${path}`;
      if (drafts.has(key)) return;
      const item: Draft = { key, name: path.split('/').at(-1)!, title: `${draft.title.split('/')[0]}/${path}`, description: 'Project file',
        source, baseline: saved ? source : '', projectId, path, updatedAt: Date.now() };
      drafts.set(key, item);
      addOption(item);
      persist();
      return key;
    },
    flush() {
      syncSources();
      persist();
    },
  };
}
