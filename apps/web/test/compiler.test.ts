import { expect, it, vi } from 'vitest';
import { CompilerStartupError, createCompiler } from '../src/compiler';

it('shares initialization, retries failures, and caches only successful resources', async () => {
  const resources = { d2: { compile: vi.fn(), render: vi.fn(), dispose: vi.fn() }, fonts: {} };
  const load = vi.fn().mockRejectedValueOnce(new Error('Worker unavailable')).mockResolvedValue(resources);
  const compiler = createCompiler(load);
  const first = compiler.get();
  expect(compiler.get()).toBe(first);
  await expect(first).rejects.toBeInstanceOf(CompilerStartupError);
  expect(compiler.ready).toBe(false);
  expect(await compiler.get()).toBe(resources);
  expect(await compiler.get()).toBe(resources);
  expect(load).toHaveBeenCalledTimes(2);
  expect(compiler.ready).toBe(true);
  compiler.dispose();
  expect(resources.d2.dispose).toHaveBeenCalledOnce();
});

it('restarts the worker and does not let obsolete startup replace the new resources', async () => {
  const old = { d2: { dispose: vi.fn() }, fonts: {} };
  const fresh = { d2: { dispose: vi.fn() }, fonts: {} };
  let resolve!: (value: unknown) => void;
  const load = vi.fn().mockImplementationOnce(() => new Promise((done) => { resolve = done; })).mockResolvedValue(fresh);
  const compiler = createCompiler(load);
  const first = compiler.get();
  compiler.restart();
  expect(await compiler.get()).toBe(fresh);
  resolve(old);
  await expect(first).rejects.toBeInstanceOf(CompilerStartupError);
  expect(old.d2.dispose).toHaveBeenCalledOnce();
  expect(await compiler.get()).toBe(fresh);
  compiler.restart();
  expect(fresh.d2.dispose).toHaveBeenCalledOnce();
  expect(compiler.ready).toBe(false);
});
