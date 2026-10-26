export type Draft = { key: string; name: string; title: string; description: string; source: string; baseline: string;
  updatedAt?: number; projectId?: string; path?: string; recoveredFrom?: string; number?: number; template?: string };
type Clock = Record<string, number>;
type Version = { id: string; key: string; clock: Clock; savedAt: number; draft: Draft | null };
type StoredVersion = Version & { slot: string };
const prefix = 'zoomflow.draft.v2:';
const selectionKey = 'zoomflow.selection.v2';
const secondSelectionKey = 'zoomflow.selection.v2:second';
const legacyKey = 'zoomflow.drafts.v1';
/** Draft fields are primitives, so a shallow comparison finds the edited drafts without serializing each one. */
const sameDraft = (a: Draft, b: Draft) => {
  for (const key in a) if (a[key as keyof Draft] !== b[key as keyof Draft]) return false;
  for (const key in b) if (a[key as keyof Draft] !== b[key as keyof Draft]) return false;
  return true;
};
const dominates = (a: Clock, b: Clock) => Object.entries(b).every(([writer, count]) => (a[writer] ?? 0) >= count);
function validDraft(value: unknown): value is Draft {
  const d = value as Draft | null;
  return Boolean(d && ['key', 'name', 'title', 'description', 'source', 'baseline'].every((key) => typeof d[key as keyof Draft] === 'string') &&
    (!d.projectId || typeof d.projectId === 'string' && typeof d.path === 'string'));
}

/** Revisions have immutable storage keys. Vector clocks distinguish a newer save
 * from concurrent edits, including saves racing in different browser processes.
 * Write the replacement before reclaiming its ancestors; immutable keys ensure
 * cleanup cannot remove a newer save that arrived after we read the old revision.
 */
export class DraftStore {
  private readonly writer: string;
  private clocks = new Map<string, Clock>();
  private pendingCopies = new Set<string>();
  private pendingMigration = new Set<string>();
  private observed = new Map<string, Clock>();
  /** A copy of each document as last saved or loaded; callers edit their drafts in place. */
  private baselines = new Map<string, Draft>();
  constructor(private storage: Storage, writer: string = crypto.randomUUID()) { this.writer = writer; }

  /** `keys` limits the scan to those documents' records. */
  private versions(keys?: Set<string>) {
    const records: StoredVersion[] = [];
    for (let i = 0; i < this.storage.length; i++) {
      const key = this.storage.key(i)!;
      if (!key.startsWith(prefix) || keys && !keys.has(DraftStore.documentOf(key))) continue;
      try {
        const v = JSON.parse(this.storage.getItem(key)!);
        // A baseline equal to the source is stored once, as null.
        if (v?.draft && v.draft.baseline === null) v.draft.baseline = v.draft.source;
        if (typeof v.id === 'string' && typeof v.key === 'string' && Number.isFinite(v.savedAt) && v.clock &&
          Object.values(v.clock).every((n) => Number.isSafeInteger(n) && Number(n) > 0) &&
          (v.draft === null || validDraft(v.draft) && v.draft.key === v.key)) records.push({ ...v, slot: key });
      } catch { /* A damaged record does not prevent recovering other documents. */ }
    }
    return records;
  }

  load(): { drafts: Draft[]; current?: string; second?: string; recoveryAvailable: boolean } {
    const records = this.versions();
    // Migration is idempotent: tabs use the same legacy writer slot, and the old
    // backup is removed only after every migrated record was written successfully.
    let recoveryAvailable = true;
    let legacy: { drafts?: unknown[]; current?: unknown } | null = null;
    try { legacy = JSON.parse(this.storage.getItem(legacyKey) ?? 'null'); }
    catch { recoveryAvailable = false; }
    if (Array.isArray(legacy?.drafts)) {
      for (const draft of legacy.drafts.filter(validDraft)) {
        if (records.some((record) => record.key === draft.key)) continue;
        const version: Version = { id: 'legacy', key: draft.key, clock: { legacy: 1 }, savedAt: 0, draft };
        const slot = `${prefix}${encodeURIComponent(draft.key)}:legacy`;
        records.push({ ...version, slot });
        try { this.storage.setItem(slot, JSON.stringify(version)); }
        catch { this.pendingMigration.add(draft.key); recoveryAvailable = false; }
      }
      try {
        if (!this.storage.getItem(selectionKey) && typeof legacy.current === 'string') this.storage.setItem(selectionKey, legacy.current);
        if (!this.pendingMigration.size) this.storage.removeItem(legacyKey);
      } catch { recoveryAvailable = false; }
    }
    const drafts = new Map<string, Draft>();
    const canonical = new Map<string, Draft>();
    const deleted = new Set<string>();
    for (const key of new Set(records.map((record) => record.key))) {
      const versions = records.filter((record) => record.key === key);
      const tips = versions.filter((v) => !versions.some((other) => other !== v && dominates(other.clock, v.clock)))
        .sort((a, b) => b.savedAt - a.savedAt || b.id.localeCompare(a.id));
      const observed: Clock = {};
      for (const version of versions) for (const [writer, count] of Object.entries(version.clock)) observed[writer] = Math.max(observed[writer] ?? 0, count);
      this.observed.set(key, observed);
      const winner = tips[0];
      if (!winner) continue;
      // A deletion cannot discard a simultaneous edit from another tab.
      const live = tips.filter((v) => v.draft !== null);
      const selected = live[0] ?? winner;
      this.clocks.set(key, selected.clock);
      if (selected.draft) canonical.set(key, selected.draft);
      else deleted.add(key);
      for (const alternative of live.slice(1)) {
        if (alternative.draft!.source === selected.draft!.source && alternative.draft!.baseline === selected.draft!.baseline) continue;
        const recoveredKey = `file:recovered:${encodeURIComponent(key)}:${alternative.id}`;
        drafts.set(recoveredKey, { ...alternative.draft!, key: recoveredKey, recoveredFrom: key,
          title: `${alternative.draft!.title} (recovered)`, description: 'Concurrent edits preserved from another tab' });
      }
    }
    // Explicit edits/removals of recovered copies take precedence over generated copies.
    for (const [key, draft] of canonical) drafts.set(key, draft);
    for (const key of deleted) drafts.delete(key);
    for (const draft of drafts.values()) {
      this.baselines.set(draft.key, { ...draft });
      // Make a generated copy durable before its original can be restored or removed.
      if (draft.recoveredFrom && !canonical.has(draft.key)) this.pendingCopies.add(draft.key);
    }
    return { drafts: [...drafts.values()], current: this.storage.getItem(selectionKey) ?? (typeof legacy?.current === 'string' ? legacy.current : undefined),
      second: this.storage.getItem(secondSelectionKey) ?? undefined, recoveryAvailable };
  }

  /** `second` is the document open in the split view's second pane, if any. */
  /** A draft that does not fit in storage is skipped so the others are still saved; the save then
   * throws once every other draft and the selection were written, and retries the skipped drafts next time. */
  save(drafts: Draft[], current: string, second?: string) {
    const next = new Map(drafts.map((draft) => [draft.key, draft]));
    const written = new Map<string, Version>();
    let failure: unknown;
    let pruned = false;
    for (const key of new Set([...next.keys(), ...this.baselines.keys()])) {
      const draft = next.get(key) ?? null;
      const baseline = this.baselines.get(key);
      const unchanged = draft ? baseline !== undefined && sameDraft(draft, baseline) : baseline === undefined;
      if (unchanged && !this.pendingMigration.has(key) && !this.pendingCopies.has(key)) continue;
      const clock = { ...this.clocks.get(key) };
      if (!draft) for (const [writer, count] of Object.entries(this.observed.get(key) ?? {})) clock[writer] = Math.max(clock[writer] ?? 0, count);
      clock[this.writer] = (clock[this.writer] ?? 0) + 1;
      const version: Version = { id: `${this.writer}-${clock[this.writer]}`, key, clock, savedAt: Date.now(), draft };
      const slot = `${prefix}${encodeURIComponent(key)}:${version.id}`;
      const value = JSON.stringify(draft && draft.baseline === draft.source ? { ...version, draft: { ...draft, baseline: null } } : version);
      try { this.storage.setItem(slot, value); }
      catch {
        // Storage is likely full: reclaim superseded revisions, including this save's, and try once more.
        // Reclaiming scans all of storage, so a save does it once; later drafts that do not fit wait.
        try {
          if (pruned) throw new DOMException('Storage is full.', 'QuotaExceededError');
          pruned = true;
          this.prune();
          this.storage.setItem(slot, value);
        } catch (error) { failure ??= error; continue; }
      }
      this.clocks.set(key, clock);
      this.pendingMigration.delete(key);
      this.pendingCopies.delete(key);
      if (draft) this.baselines.set(key, { ...draft }); else this.baselines.delete(key);
      written.set(key, version);
    }
    // Reclaim ancestors only after every replacement was written, scanning storage once.
    if (written.size) {
      for (const previous of this.versions(new Set([...written.keys()].map(encodeURIComponent)))) {
        const version = written.get(previous.key);
        if (version && previous.id !== version.id && dominates(version.clock, previous.clock) &&
          previous.slot === `${prefix}${encodeURIComponent(previous.key)}:${previous.id}`) this.storage.removeItem(previous.slot);
      }
    }
    this.storage.setItem(selectionKey, current);
    if (second) this.storage.setItem(secondSelectionKey, second);
    else this.storage.removeItem(secondSelectionKey);
    if (failure) throw failure;
  }

  /** Remove revisions that a strictly newer stored revision of the same document supersedes. */
  private prune() {
    const records = this.versions();
    for (const record of records) {
      if (record.slot === `${prefix}${encodeURIComponent(record.key)}:${record.id}` && records.some((other) => other.key === record.key &&
        dominates(other.clock, record.clock) && !dominates(record.clock, other.clock))) this.storage.removeItem(record.slot);
    }
  }

  /** The documents another tab saved without this tab seeing those versions.
   * `documents` limits the check to the records named by `DraftStore.documentOf`. */
  concurrentChanges(documents?: Set<string>) {
    return [...new Set(this.versions(documents).filter((record) => {
      if (!this.clocks.has(record.key)) return false;
      const known = { ...this.observed.get(record.key) };
      for (const [writer, count] of Object.entries(this.clocks.get(record.key)!)) known[writer] = Math.max(known[writer] ?? 0, count);
      return !dominates(known, record.clock);
    }).map((record) => record.key))];
  }
  static isDraftEvent(key: string | null) { return key === null || key.startsWith(prefix); }
  /** The encoded document a draft storage key belongs to, as `concurrentChanges` accepts it. */
  static documentOf(storageKey: string) { return storageKey.slice(prefix.length, storageKey.lastIndexOf(':')); }
}
