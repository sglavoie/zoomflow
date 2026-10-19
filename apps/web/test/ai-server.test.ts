import { afterEach, expect, it, vi } from 'vitest';
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { runAi } from '../ai-server';

const originalPath = process.env.PATH;
let fakeBin: string | undefined;
afterEach(async () => {
  process.env.PATH = originalPath;
  if (fakeBin) await rm(fakeBin, { recursive: true, force: true });
  fakeBin = undefined;
});

async function fakeCommand(name: string, output: object | string, exit = 0, expectedEnv: Record<string, string> = {}) {
  fakeBin ??= await mkdtemp(join(tmpdir(), 'zoomflow-ai-test-'));
  const path = join(fakeBin, name);
  const stdout = typeof output === 'string' ? output : JSON.stringify(output);
  await writeFile(path, `#!/usr/bin/env node
let prompt = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => prompt += chunk);
process.stdin.on('end', () => {
  if (!prompt.includes('Current board: root.layers.checkout') || !prompt.includes('old: Old')) process.exit(4);
  for (const [name, value] of Object.entries(${JSON.stringify(expectedEnv)})) {
    if (process.env[name] !== value) { process.stderr.write('Unexpected ' + name); process.exit(5); }
  }
  process.stdout.write(${JSON.stringify(stdout)});
  process.exit(${exit});
});
`);
  await chmod(path, 0o755);
  process.env.PATH = `${fakeBin}:${originalPath}`;
}

const request = { prompt: 'Rename the box', source: 'old: Old', name: 'example.d2', board: 'root.layers.checkout' };

it('runs Claude Code and reads structured output', async () => {
  await fakeCommand('claude', { is_error: false, structured_output: { reply: 'Renamed.', source: 'new: New' } }, 0,
    { CLAUDE_CONFIG_DIR: join(homedir(), '.claude') });
  await expect(runAi({ ...request, provider: 'claude' })).resolves.toEqual({ reply: 'Renamed.', source: 'new: New' });
});

it('passes custom environment and lets the Claude config field take precedence', async () => {
  await fakeCommand('claude', { is_error: false, structured_output: { reply: 'Done.', source: null } }, 0,
    { CLAUDE_CONFIG_DIR: join(homedir(), 'other-claude'), TEST_VALUE: 'one=two', EMPTY_VALUE: '' });
  await expect(runAi({ ...request, provider: 'claude', claudeConfigDir: '~/other-claude',
    environment: '# comment\nTEST_VALUE=one=two\nEMPTY_VALUE=\nCLAUDE_CONFIG_DIR=/ignored' }))
    .resolves.toEqual({ reply: 'Done.', source: null });
});

it('runs Codex and accepts an answer without a source change', async () => {
  await fakeCommand('codex', { reply: 'This is the checkout board.', source: null }, 0, { TEST_VALUE: 'codex' });
  await expect(runAi({ ...request, provider: 'codex', environment: 'TEST_VALUE=codex' }))
    .resolves.toEqual({ reply: 'This is the checkout board.', source: null });
});

it('rejects malformed environment lines before starting a CLI', async () => {
  await expect(runAi({ ...request, provider: 'codex', environment: 'bad name=value' }))
    .rejects.toThrow('Environment line 1 must be NAME=value.');
  await expect(runAi({ ...request, provider: 'claude', claudeConfigDir: ' ' }))
    .rejects.toThrow('CLAUDE_CONFIG_DIR cannot be empty.');
});

it('reports CLI failure and malformed output', async () => {
  await fakeCommand('codex', 'Authentication failed', 1);
  await expect(runAi({ ...request, provider: 'codex' })).rejects.toThrow('codex failed: Authentication failed');
  await fakeCommand('codex', 'not JSON');
  await expect(runAi({ ...request, provider: 'codex' })).rejects.toThrow();
});

it('cancels a running CLI process when its request is aborted', async () => {
  fakeBin = await mkdtemp(join(tmpdir(), 'zoomflow-ai-test-'));
  const pidPath = join(fakeBin, 'pid');
  const command = join(fakeBin, 'codex');
  await writeFile(command, `#!/usr/bin/env node\nrequire('node:fs').writeFileSync(${JSON.stringify(pidPath)}, String(process.pid));\nsetInterval(() => {}, 1000);\n`);
  await chmod(command, 0o755);
  process.env.PATH = `${fakeBin}:${originalPath}`;
  const controller = new AbortController();
  const result = runAi({ ...request, provider: 'codex' }, controller.signal);
  const rejected = expect(result).rejects.toThrow('canceled');
  try {
    let pid = 0;
    await vi.waitFor(async () => { pid = Number(await readFile(pidPath, 'utf8')); expect(pid).toBeGreaterThan(0); });
    controller.abort();
    await rejected;
    expect(() => process.kill(pid, 0)).toThrow();
  } finally { controller.abort(); }
});
