import { expect, it } from 'vitest';
import { createPreviewQueue } from '../src/preview-queue';

function gate() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

it('finishes active work and replaces intervening requests with the latest source', async () => {
  const queue = createPreviewQueue();
  const active = gate();
  const calls: string[] = [];
  const first = queue.run(async () => { calls.push('first'); await active.promise; });
  const second = queue.run(async () => { calls.push('second'); });
  const last = queue.run(async () => { calls.push('last'); });
  await second;
  expect(calls).toEqual(['first']);
  active.resolve();
  await Promise.all([first, last]);
  expect(calls).toEqual(['first', 'last']);
});

it('invalidates pending work immediately, including during the next edit debounce', async () => {
  const queue = createPreviewQueue();
  const active = gate();
  const calls: string[] = [];
  const first = queue.run(async () => { await active.promise; });
  const pending = queue.run(async () => { calls.push('obsolete document'); });
  queue.invalidate();
  await pending;
  active.resolve();
  await first;
  expect(calls).toEqual([]);
  await queue.run(async () => { calls.push('new document'); });
  expect(calls).toEqual(['new document']);
});

it('a failure settles its caller and does not strand the newest request', async () => {
  const queue = createPreviewQueue();
  const active = gate();
  const first = queue.run(async () => { await active.promise; throw new Error('Invalid source'); });
  const failed = expect(first).rejects.toThrow('Invalid source');
  let recovered = false;
  const last = queue.run(async () => { recovered = true; });
  active.resolve();
  await Promise.all([failed, last]);
  expect(recovered).toBe(true);
});

it('restart releases blocked callers and late completion cannot drain or unlock the new queue', async () => {
  const queue = createPreviewQueue();
  const old = gate();
  const fresh = gate();
  const calls: string[] = [];
  const first = queue.run(async () => { await old.promise; });
  const pending = queue.run(async () => { calls.push('obsolete'); });
  queue.restart();
  await Promise.all([first, pending]);
  const next = queue.run(async () => { calls.push('fresh'); await fresh.promise; });
  old.resolve();
  await Promise.resolve();
  const last = queue.run(async () => { calls.push('last'); });
  await Promise.resolve();
  expect(calls).toEqual(['fresh']);
  fresh.resolve();
  await Promise.all([next, last]);
  expect(calls).toEqual(['fresh', 'last']);
});
