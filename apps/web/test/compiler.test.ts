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
