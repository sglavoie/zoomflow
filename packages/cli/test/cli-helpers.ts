import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { afterAll, beforeAll, expect } from 'vitest';
import { chromium, type Browser } from '@playwright/test';

export const exec = promisify(execFile);

export const repo = fileURLToPath(new URL('../../../', import.meta.url));

export const cli = resolve(repo, 'packages/cli/bin/zoomflow.mjs');

export let temp: string;

export let browser: Browser;

beforeAll(async () => {
  [, temp, browser] = await Promise.all([exec(process.execPath, ['packages/cli/build.mjs'], { cwd: repo }),
    mkdtemp(join(tmpdir(), 'zoomflow-cli-test-')), chromium.launch()]);
});

afterAll(async () => {
  await browser?.close();
  if (temp) await rm(temp, { recursive: true, force: true });
});

export async function run(args: string[], options: { cwd?: string; env?: NodeJS.ProcessEnv } = {}) {
  try {
    const result = await exec(process.execPath, [cli, ...args], { cwd: repo, timeout: 180_000, maxBuffer: 4 * 1024 * 1024, ...options });
    return { ...result, code: 0 };
  } catch (error) {
    const failure = error as Error & { code: number; stdout: string; stderr: string; killed?: boolean };
    if (failure.killed || typeof failure.code !== 'number') throw error;
    return { code: failure.code, stdout: failure.stdout, stderr: failure.stderr };
  }
}

export function success(result: Awaited<ReturnType<typeof run>>) { expect(result.code, result.stderr).toBe(0); }

export const embedded = (html: string) => JSON.parse(html.match(/<script id="zoomflow-data" type="application\/json">(.*?)<\/script>/s)![1]);
