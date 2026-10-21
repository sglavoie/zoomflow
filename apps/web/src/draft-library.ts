import { examples } from './examples';
import { DraftStore, type Draft } from './draft-store';
import type { PaneId } from './pane-scope';
import { setText } from './text';

export const exampleSource = (key: string) => examples.find((example) => example.name === key)?.source;
/** The draft differs from a bundled example, so only the browser or a file keeps it. */
export const isOwnDraft = (item: Draft) => item.key.startsWith('file:') || Boolean(item.projectId) ||
  item.source !== exampleSource(item.key) || item.baseline !== exampleSource(item.key);

/** The bundled examples and the person's drafts, which pane shows each, and their browser backup.
 * `changed` runs after every save or scheduled save. */
export function createDraftLibrary(changed: () => void) {
  let store: DraftStore | undefined;
  const conflictNotice = document.querySelector<HTMLElement>('#draft-conflict')!;
  const drafts = new Map<string, Draft>(examples.map((example) => [example.name, {
    key: example.name, name: example.name, title: example.title, description: example.description,
    source: example.source, baseline: example.source,
  }]));
  const current: Record<PaneId, string | undefined> = { a: examples[0].name, b: undefined };
  let fileNumber = 0;
  let recoveryAvailable = true;
  let savePending = false;
  let storedSecond: string | undefined;
  let saveTimer: ReturnType<typeof setTimeout> | undefined;
  let conflictShown = false;
  const conflictMessage = 'Drafts changed in another tab. Your open source is unchanged. Reload to review saved versions; conflicting edits appear as recovered copies.';

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
    if (saved.current && drafts.has(saved.current)) current.a = saved.current;
    if (saved.second !== current.a && saved.second && drafts.has(saved.second)) storedSecond = saved.second;
  } catch { recoveryAvailable = false; }
  /** The notice stays rendered so screen readers announce its text when a conflict appears.
   * `documents` limits the check to those documents' records. */
  function checkConflicts(documents?: Set<string>) {
    try {
      conflictShown = Boolean(store?.hasConcurrentChanges(documents));
      setText(conflictNotice, conflictShown ? conflictMessage : '');
    } catch { /* Saving reports storage failures beside the save control. */ }
  }
  // Each save in another tab writes several keys; check the changed documents once per burst.
  let changedDocuments: Set<string> | undefined;
  let everyDocument = false;
  let conflictTimer: ReturnType<typeof setTimeout> | undefined;
  window.addEventListener('storage', (event) => {
    if (!DraftStore.isDraftEvent(event.key)) return;
    if (event.key === null) everyDocument = true;
    else (changedDocuments ??= new Set()).add(DraftStore.documentOf(event.key));
    clearTimeout(conflictTimer);
    conflictTimer = setTimeout(() => {
      // Only a full check can end a conflict that is already shown.
      const documents = everyDocument || conflictShown ? undefined : changedDocuments;
      changedDocuments = undefined;
      everyDocument = false;
      checkConflicts(documents);
    }, 100);
  });
  function persist() {
    clearTimeout(saveTimer);
    savePending = false;
    try {
      if (!store) store = new DraftStore(localStorage);
      store.save([...drafts.values()].filter(isOwnDraft), current.a!, current.b);
      // Only another tab's writes, announced by storage events, start a conflict; a save can end one.
      if (conflictShown) checkConflicts();
      recoveryAvailable = true;
    } catch { recoveryAvailable = false; }
    changed();
  }
  function schedulePersist() {
    clearTimeout(saveTimer);
    savePending = true;
    changed();
    saveTimer = setTimeout(persist, 400);
  }
  function draftOf(pane: PaneId) { return current[pane] === undefined ? undefined : drafts.get(current[pane]!); }

  return {
    drafts,
    current,
    draftOf,
    get recoveryAvailable() { return recoveryAvailable; },
    get savePending() { return savePending; },
    nextNumber: () => ++fileNumber,
    /** The second pane's draft before a reload, offered once when the split first opens. */
    takeStoredSecond() {
      const key = storedSecond;
      storedSecond = undefined;
      return key;
    },
    persist,
    schedulePersist,
    /** The compiled file's path, without collecting the project's files. */
    inputPath(pane: PaneId) {
      const draft = draftOf(pane);
      return draft?.projectId && draft.path ? draft.path : 'index';
    },
    compilation(pane: PaneId) {
      const draft = draftOf(pane);
      if (!draft) return { inputPath: 'index', fs: { index: '' } };
      if (!draft.projectId || !draft.path) return { inputPath: 'index', fs: { index: draft.source } };
      const fs: Record<string, string> = Object.create(null);
      for (const item of drafts.values()) if (item.projectId === draft.projectId && item.path && !item.recoveredFrom) fs[item.path] = item.source;
      fs[draft.path] = draft.source;
      return { inputPath: draft.path, fs };
    },
  };
}
