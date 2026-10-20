import { describe, expect, test } from 'vitest';
import { DraftStore, type Draft } from '../src/draft-store';
class MemoryStorage implements Storage {
  data = new Map<string, string>();
  get length() { return this.data.size; }
  key(i: number) { return [...this.data.keys()][i] ?? null; }
  getItem(key: string) { return this.data.get(key) ?? null; }
  setItem(key: string, value: string) { this.data.set(key, value); }
  removeItem(key: string) { this.data.delete(key); }
  clear() { this.data.clear(); }
}
const draft = (key: string, source: string): Draft => ({ key, name: `${key}.d2`, title: key, description: '', source, baseline: 'original' });
describe('draft recovery across tabs', () => {
  test('independent documents and concurrent edits both survive reload', () => {
    const storage = new MemoryStorage();
    const a = new DraftStore(storage, 'a'), b = new DraftStore(storage, 'b');
    a.load(); b.load();
    a.save([draft('order', 'first'), draft('other', 'keep')], 'order');
    b.save([draft('order', 'second')], 'order');
    expect(a.hasConcurrentChanges()).toBe(true);
    const recovered = new DraftStore(storage, 'reader').load().drafts;
    expect(recovered.map((d) => d.source).sort()).toEqual(['first', 'keep', 'second']);
    expect(recovered.filter((d) => d.recoveredFrom === 'order')).toHaveLength(1);
    // A late pagehide flush in either tab must not overwrite the other version.
    a.save([draft('order', 'first'), draft('other', 'keep')], 'order');
    expect(new DraftStore(storage, 'reload').load().drafts.map((d) => d.source).sort()).toEqual(['first', 'keep', 'second']);
  });
  test('sequential updates replace their ancestors without creating false conflicts', () => {
    const storage = new MemoryStorage();
    const a = new DraftStore(storage, 'a'); a.load(); a.save([draft('order', 'first')], 'order');
    const b = new DraftStore(storage, 'b'); b.load(); b.save([draft('order', 'second')], 'order');
    expect(new DraftStore(storage, 'reader').load().drafts.map((d) => d.source)).toEqual(['second']);
  });
  test('concurrent edits survive deletion and recovered copies can be edited or removed', () => {
    const storage = new MemoryStorage();
    const seed = new DraftStore(storage, 'seed'); seed.load(); seed.save([draft('order', 'original')], 'order');
    const a = new DraftStore(storage, 'a'), b = new DraftStore(storage, 'b'); a.load(); b.load();
    a.save([], ''); b.save([draft('order', 'changed')], 'order');
    expect(new DraftStore(storage, 'r').load().drafts.map((d) => d.source)).toEqual(['changed']);
    a.save([draft('order', 'parallel')], 'order');
    const reader = new DraftStore(storage, 'reader');
    const recovered = reader.load().drafts;
    const copy = recovered.find((d) => d.recoveredFrom)!;
    expect(copy).toBeDefined();
    copy.source = 'edited copy'; reader.save(recovered, copy.key);
    const reload = new DraftStore(storage, 'reload');
    const loaded = reload.load().drafts;
    expect(loaded.find((d) => d.key === copy.key)?.source).toBe('edited copy');
    reload.save(loaded.filter((d) => d.key !== copy.key), 'order');
    expect(new DraftStore(storage, 'last').load().drafts.some((d) => d.key === copy.key)).toBe(false);
  });
  test('migrates the old backup and preserves project context on conflicting copies', () => {
    const storage = new MemoryStorage();
    const project = { ...draft('project:p:main.d2', 'original'), projectId: 'p', path: 'main.d2' };
    storage.setItem('zoomflow.drafts.v1', JSON.stringify({ current: project.key, drafts: [project] }));
    const a = new DraftStore(storage, 'a'), b = new DraftStore(storage, 'b');
    expect(a.load().current).toBe(project.key); b.load();
    expect(storage.getItem('zoomflow.drafts.v1')).toBeNull();
    a.save([{ ...project, source: 'a' }], project.key); b.save([{ ...project, source: 'b' }], project.key);
    const copies = new DraftStore(storage, 'reader').load().drafts;
    expect(copies).toHaveLength(2);
    expect(copies.every((d) => d.projectId === 'p' && d.path === 'main.d2')).toBe(true);
  });
  test('removing observed conflicts removes both copies without reviving an older version', () => {
    const storage = new MemoryStorage();
    const a = new DraftStore(storage, 'a'), b = new DraftStore(storage, 'b'); a.load(); b.load();
    a.save([draft('order', 'first')], 'order'); b.save([draft('order', 'second')], 'order');
    const reader = new DraftStore(storage, 'reader');
    expect(reader.load().drafts).toHaveLength(2);
    reader.save([], '');
    expect(new DraftStore(storage, 'last').load().drafts).toEqual([]);
  });
  test('concurrent edits to a recovered copy are themselves recoverable', () => {
    const storage = new MemoryStorage();
    const a = new DraftStore(storage, 'a'), b = new DraftStore(storage, 'b'); a.load(); b.load();
    a.save([draft('order', 'first')], 'order'); b.save([draft('order', 'second')], 'order');
    const c = new DraftStore(storage, 'c'), d = new DraftStore(storage, 'd');
    const left = c.load().drafts, right = d.load().drafts;
    left.find((item) => item.recoveredFrom)!.source = 'left copy';
    right.find((item) => item.recoveredFrom)!.source = 'right copy';
    c.save(left, 'order'); d.save(right, 'order');
    const sources = new DraftStore(storage, 'reader').load().drafts.map((item) => item.source);
    expect(sources).toContain('left copy'); expect(sources).toContain('right copy');
  });

  test('a full storage quota cannot prevent reading the existing legacy backup', () => {
    const storage = new MemoryStorage();
    storage.setItem('zoomflow.drafts.v1', JSON.stringify({ current: 'order', drafts: [draft('order', 'precious edits')] }));
    const write = storage.setItem.bind(storage);
    storage.setItem = () => { throw new Error('Quota exceeded'); };
    const reader = new DraftStore(storage, 'reader');
    const loaded = reader.load();
    expect(loaded.drafts[0].source).toBe('precious edits');
    expect(loaded.current).toBe('order');
    expect(loaded.recoveryAvailable).toBe(false);
    expect(storage.getItem('zoomflow.drafts.v1')).not.toBeNull();
    storage.setItem = write;
    reader.save(loaded.drafts, 'order');
    expect(new DraftStore(storage, 'reload').load().drafts[0].source).toBe('precious edits');
  });

  test('removing an original keeps its unedited recovered copy as an independent backup', () => {
    const storage = new MemoryStorage();
    const a = new DraftStore(storage, 'a'), b = new DraftStore(storage, 'b'); a.load(); b.load();
    a.save([draft('order', 'first')], 'order'); b.save([draft('order', 'second')], 'order');
    const reader = new DraftStore(storage, 'reader');
    const copy = reader.load().drafts.find((item) => item.recoveredFrom)!;
    expect(reader.hasConcurrentChanges()).toBe(false);
    reader.save([copy], copy.key);
    const reloaded = new DraftStore(storage, 'last').load().drafts;
    expect(reloaded).toHaveLength(1);
    expect(reloaded[0].source).toBe(copy.source);
    expect(reloaded[0].key).toBe(copy.key);
  });

  test('sequential saves and reloads reclaim superseded sources', () => {
    const storage = new MemoryStorage();
    for (let i = 0; i < 30; i++) {
      const tab = new DraftStore(storage, `tab-${i}`); tab.load();
      tab.save([draft('order', `revision ${i}`)], 'order');
      expect([...storage.data.keys()].filter((key) => key.startsWith('zoomflow.draft.v2:'))).toHaveLength(1);
    }
    const tab = new DraftStore(storage, 'remove'); tab.load(); tab.save([], '');
    expect([...storage.data.values()].some((value) => value.includes('revision 29'))).toBe(false);
    expect(new DraftStore(storage, 'reload').load().drafts).toEqual([]);
  });
  test('cleanup cannot delete a concurrent save that arrives after reading an ancestor', () => {
    const storage = new MemoryStorage();
    const a = new DraftStore(storage, 'a'); a.load(); a.save([draft('order', 'original')], 'order');
    const b = new DraftStore(storage, 'b'); b.load();
    const remove = storage.removeItem.bind(storage);
    let raced = false;
    storage.removeItem = (key) => {
      if (!raced) { raced = true; b.save([draft('order', 'concurrent')], 'order'); }
      remove(key);
    };
    a.save([draft('order', 'latest')], 'order');
    expect(raced).toBe(true);
    expect(new DraftStore(storage, 'reload').load().drafts.map((d) => d.source).sort()).toEqual(['concurrent', 'latest']);
  });
  test('the split view second pane selection survives reload until the pane closes', () => {
    const storage = new MemoryStorage();
    const store = new DraftStore(storage, 'a'); store.load();
    store.save([draft('order', 'one'), draft('other', 'two')], 'order', 'other');
    expect(new DraftStore(storage, 'reload').load()).toMatchObject({ current: 'order', second: 'other' });
    store.save([draft('order', 'one'), draft('other', 'two')], 'order');
    expect(new DraftStore(storage, 'reload').load().second).toBeUndefined();
  });

});
