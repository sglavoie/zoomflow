import { afterEach, expect, it, vi } from 'vitest';
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer, request as httpRequest, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Readable } from 'node:stream';
import { handle, providerStatus, readBody, runAi } from '../ai-server';

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

async function fakeStatus(name: string, output: object | string, exit = 0) {
  fakeBin ??= await mkdtemp(join(tmpdir(), 'zoomflow-ai-test-'));
  const path = join(fakeBin, name);
  const stdout = typeof output === 'string' ? output : JSON.stringify(output);
  await writeFile(path, `#!/usr/bin/env node\nprocess.stdout.write(${JSON.stringify(stdout)}); process.exit(${exit});\n`);
  await chmod(path, 0o755);
  process.env.PATH = `${fakeBin}:${originalPath}`;
}

it('checks installed provider sign-in before allowing a request', async () => {
  await fakeStatus('codex', 'Not logged in');
  await expect(providerStatus({ provider: 'codex', environment: 'OPENAI_API_KEY=' })).resolves.toMatchObject({ available: false });
  await fakeStatus('codex', 'Logged in using ChatGPT');
  await expect(providerStatus({ provider: 'codex' })).resolves.toEqual({ available: true });
  await fakeStatus('claude', { loggedIn: false });
  await expect(providerStatus({ provider: 'claude', environment: 'ANTHROPIC_API_KEY=' })).resolves.toMatchObject({ available: false });
  await fakeStatus('claude', { loggedIn: true });
  await expect(providerStatus({ provider: 'claude' })).resolves.toEqual({ available: true });
});

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
    await vi.waitFor(async () => { pid = Number(await readFile(pidPath, 'utf8')); expect(pid).toBeGreaterThan(0); }, { timeout: 10_000 });
    controller.abort();
    await rejected;
    await vi.waitFor(() => expect(() => process.kill(pid, 0)).toThrow(), { timeout: 5_000 });
  } finally { controller.abort(); }
});

/** A response stand-in that records what `send` writes. */
function fakeResponse() {
  const sent: { status?: number; body?: string } = {};
  const response = { destroyed: false, writableEnded: false,
    writeHead(status: number) { sent.status = status; return response; },
    end(body: string) { sent.body = body; response.writableEnded = true; } };
  return { response: response as unknown as ServerResponse, sent };
}

it('keeps multi-byte characters that are split across body chunks', async () => {
  const body = Buffer.from(JSON.stringify({ source: 'café: Café 🚀' }));
  const accent = body.indexOf(Buffer.from('é'));
  const rocket = body.indexOf(Buffer.from('🚀'));
  const chunks = [body.subarray(0, accent + 1), body.subarray(accent + 1, rocket + 2), body.subarray(rocket + 2)];
  const { response, sent } = fakeResponse();
  await expect(readBody(Readable.from(chunks), response, body.length, 'Too large.')).resolves.toBe(body.toString('utf8'));
  expect(sent.status).toBeUndefined();
});

it('limits request bodies by bytes rather than characters', async () => {
  const { response, sent } = fakeResponse();
  // Three characters, six bytes.
  await expect(readBody(Readable.from([Buffer.from('ééé')]), response, 5, 'Too large.')).resolves.toBeUndefined();
  expect(sent).toEqual({ status: 413, body: JSON.stringify({ error: 'Too large.' }) });
});

it('answers non-JSON requests with 415 and other methods with 405', async () => {
  const server = createServer((request, response) => void handle(request, response));
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const { port } = server.address() as AddressInfo;
  const call = (method: string, path: string, contentType?: string) => new Promise<{ status: number; error: string }>((done, fail) => {
    const outgoing = httpRequest({ host: '127.0.0.1', port, method, path, headers: contentType ? { 'Content-Type': contentType } : {} }, (incoming) => {
      let text = '';
      incoming.setEncoding('utf8');
      incoming.on('data', (chunk: string) => { text += chunk; });
      incoming.on('end', () => done({ status: incoming.statusCode ?? 0, error: (JSON.parse(text) as { error?: string }).error ?? '' }));
    });
    outgoing.on('error', fail);
    outgoing.end(method === 'POST' ? 'provider=codex' : undefined);
  });
  try {
    await expect(call('POST', '/api/ai/status', 'text/plain')).resolves.toEqual({ status: 415, error: 'Send JSON to check a provider.' });
    await expect(call('PUT', '/api/ai/status', 'application/json')).resolves.toEqual({ status: 405, error: 'Use POST to check a provider.' });
    await expect(call('POST', '/api/ai', 'text/plain')).resolves.toEqual({ status: 415, error: 'Send the AI request as JSON.' });
    await expect(call('GET', '/api/ai')).resolves.toEqual({ status: 405, error: 'Send a JSON POST request.' });
  } finally { await new Promise((done) => server.close(done)); }
});
