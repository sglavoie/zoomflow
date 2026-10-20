export type Draft = { key: string; name: string; title: string; description: string; source: string; baseline: string;
  updatedAt?: number; projectId?: string; path?: string; recoveredFrom?: string; number?: number; template?: string };
type Clock = Record<string, number>;
type Version = { id: string; key: string; clock: Clock; savedAt: number; draft: Draft | null };
type StoredVersion = Version & { slot: string };
const prefix = 'zoomflow.draft.v2:';
const selectionKey = 'zoomflow.selection.v2';
const secondSelectionKey = 'zoomflow.selection.v2:second';
const legacyKey = 'zoomflow.drafts.v1';
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
  private baselines = new Map<string, string>();
  constructor(private storage: Storage, writer: string = crypto.randomUUID()) { this.writer = writer; }

  private versions() {
    const records: StoredVersion[] = [];
    for (let i = 0; i < this.storage.length; i++) {
      const key = this.storage.key(i)!;
      if (!key.startsWith(prefix)) continue;
      try {
        const v = JSON.parse(this.storage.getItem(key)!);
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
      this.baselines.set(draft.key, JSON.stringify(draft));
      // Make a generated copy durable before its original can be restored or removed.
      if (draft.recoveredFrom && !canonical.has(draft.key)) this.pendingCopies.add(draft.key);
    }
    return { drafts: [...drafts.values()], current: this.storage.getItem(selectionKey) ?? (typeof legacy?.current === 'string' ? legacy.current : undefined),
      second: this.storage.getItem(secondSelectionKey) ?? undefined, recoveryAvailable };
  }

  /** `second` is the document open in the split view's second pane, if any. */
  save(drafts: Draft[], current: string, second?: string) {
    const next = new Map(drafts.map((draft) => [draft.key, draft]));
    for (const key of new Set([...next.keys(), ...this.baselines.keys()])) {
      const draft = next.get(key) ?? null;
      const serialized = draft ? JSON.stringify(draft) : undefined;
      if (serialized === this.baselines.get(key) && !this.pendingMigration.has(key) && !this.pendingCopies.has(key)) continue;
      const clock = { ...this.clocks.get(key) };
      if (!draft) for (const [writer, count] of Object.entries(this.observed.get(key) ?? {})) clock[writer] = Math.max(clock[writer] ?? 0, count);
      clock[this.writer] = (clock[this.writer] ?? 0) + 1;
      const version: Version = { id: `${this.writer}-${clock[this.writer]}`, key, clock, savedAt: Date.now(), draft };
      const slot = `${prefix}${encodeURIComponent(key)}:${version.id}`;
      this.storage.setItem(slot, JSON.stringify(version));
      this.clocks.set(key, clock);
      this.pendingMigration.delete(key);
      this.pendingCopies.delete(key);
      if (serialized === undefined) this.baselines.delete(key); else this.baselines.set(key, serialized);
      for (const previous of this.versions()) {
        if (previous.key === key && previous.id !== version.id && dominates(clock, previous.clock) &&
          previous.slot === `${prefix}${encodeURIComponent(key)}:${previous.id}`) this.storage.removeItem(previous.slot);
      }
    }
    this.storage.setItem(selectionKey, current);
    if (second) this.storage.setItem(secondSelectionKey, second);
    else this.storage.removeItem(secondSelectionKey);
  }

  hasConcurrentChanges() {
    return this.versions().some((record) => {
      if (!this.clocks.has(record.key)) return false;
      const known = { ...this.observed.get(record.key) };
      for (const [writer, count] of Object.entries(this.clocks.get(record.key)!)) known[writer] = Math.max(known[writer] ?? 0, count);
      return !dominates(known, record.clock);
    });
  }
  static isDraftEvent(key: string | null) { return key === null || key.startsWith(prefix); }
}
