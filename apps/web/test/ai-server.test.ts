import { afterEach, expect, it, vi } from 'vitest';
import { chmod, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer, request as httpRequest, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Readable } from 'node:stream';
import { handle, isLoopbackAddress, providerStatus, readBody, requestProblem, runAi, stopRunning } from '../ai-server';

const originalPath = process.env.PATH;
const original = { CLAUDE_CONFIG_DIR: process.env.CLAUDE_CONFIG_DIR, INIT_CWD: process.env.INIT_CWD };
// The server's own CLAUDE_CONFIG_DIR is the blank field's default; start each test without one.
delete process.env.CLAUDE_CONFIG_DIR;
let fakeBin: string | undefined;
afterEach(async () => {
  process.env.PATH = originalPath;
  delete process.env.CLAUDE_CONFIG_DIR;
  if (original.INIT_CWD === undefined) delete process.env.INIT_CWD; else process.env.INIT_CWD = original.INIT_CWD;
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
  // Exit once the write flushes: large pipe writes are asynchronous on macOS.
  process.stdout.write(${JSON.stringify(stdout)}, () => process.exit(${exit}));
});
`);
  await chmod(path, 0o755);
  process.env.PATH = `${fakeBin}:${originalPath}`;
}

const request = { prompt: 'Rename the box', source: 'old: Old', name: 'example.d2', board: 'root.layers.checkout' };

async function fakeStatus(name: string, output: object | string, exit = 0, stream: 'stdout' | 'stderr' = 'stdout') {
  fakeBin ??= await mkdtemp(join(tmpdir(), 'zoomflow-ai-test-'));
  const path = join(fakeBin, name);
  const stdout = typeof output === 'string' ? output : JSON.stringify(output);
  await writeFile(path, `#!/usr/bin/env node\nprocess.${stream}.write(${JSON.stringify(stdout)}); process.exit(${exit});\n`);
  await chmod(path, 0o755);
  process.env.PATH = `${fakeBin}:${originalPath}`;
}

it('checks installed provider sign-in before allowing a request', async () => {
  // Both CLIs exit 1 when signed out but still print their status.
  await fakeStatus('codex', 'Not logged in', 1);
  await expect(providerStatus({ provider: 'codex', environment: 'OPENAI_API_KEY=' }))
    .resolves.toEqual({ available: false, reason: 'Codex is installed. Sign in with codex login.' });
  await expect(providerStatus({ provider: 'codex', environment: 'OPENAI_API_KEY=key' })).resolves.toEqual({ available: true });
  await fakeStatus('codex', 'Logged in using ChatGPT');
  await expect(providerStatus({ provider: 'codex' })).resolves.toEqual({ available: true });
  // Codex prints its login status to stderr.
  await fakeStatus('codex', 'Logged in using ChatGPT', 0, 'stderr');
  await expect(providerStatus({ provider: 'codex' })).resolves.toEqual({ available: true });
  await fakeStatus('claude', { loggedIn: false }, 1);
  await expect(providerStatus({ provider: 'claude', environment: 'ANTHROPIC_API_KEY=' }))
    .resolves.toEqual({ available: false, reason: 'Claude Code is installed. Sign in with claude auth login.' });
  await expect(providerStatus({ provider: 'claude', environment: 'ANTHROPIC_API_KEY=key' })).resolves.toEqual({ available: true });
  await fakeStatus('claude', { loggedIn: true });
  await expect(providerStatus({ provider: 'claude' })).resolves.toEqual({ available: true });
});

it('reports a status check that does not respond', async () => {
  fakeBin = await mkdtemp(join(tmpdir(), 'zoomflow-ai-test-'));
  const command = join(fakeBin, 'codex');
  await writeFile(command, '#!/usr/bin/env node\nsetInterval(() => {}, 1000);\n');
  await chmod(command, 0o755);
  process.env.PATH = `${fakeBin}:${originalPath}`;
  await expect(providerStatus({ provider: 'codex' })).resolves.toEqual({ available: false, reason: 'codex did not respond. Check again.' });
});

it('starts each CLI without the user\'s own settings', async () => {
  fakeBin = await mkdtemp(join(tmpdir(), 'zoomflow-ai-test-'));
  for (const name of ['claude', 'codex']) {
    const reply = `JSON.stringify(process.argv.slice(2))`;
    const output = name === 'claude' ? `{ is_error: false, structured_output: { reply: ${reply}, source: null } }` : `{ reply: ${reply}, source: null }`;
    await writeFile(join(fakeBin, name), `#!/usr/bin/env node\nprocess.stdin.resume();\nprocess.stdin.on('end', () => process.stdout.write(JSON.stringify(${output})));\n`);
    await chmod(join(fakeBin, name), 0o755);
  }
  process.env.PATH = `${fakeBin}:${originalPath}`;
  const args = async (provider: 'claude' | 'codex') => JSON.parse((await runAi({ ...request, provider })).reply) as string[];
  const claude = await args('claude');
  expect(claude[claude.indexOf('--setting-sources') + 1]).toBe('');
  expect(claude).not.toContain('--bare');
  expect(await args('codex')).toContain('--ignore-user-config');
});

it('bypasses permissions in the chosen working directory only when full access is on', async () => {
  fakeBin = await mkdtemp(join(tmpdir(), 'zoomflow-ai-test-'));
  for (const name of ['claude', 'codex']) {
    const reply = `JSON.stringify({ args: process.argv.slice(2), cwd: process.cwd(), prompt })`;
    const output = name === 'claude' ? `{ is_error: false, structured_output: { reply: ${reply}, source: null } }` : `{ reply: ${reply}, source: null }`;
    await writeFile(join(fakeBin, name), `#!/usr/bin/env node\nlet prompt = '';\nprocess.stdin.on('data', (chunk) => prompt += chunk);\nprocess.stdin.on('end', () => process.stdout.write(JSON.stringify(${output})));\n`);
    await chmod(join(fakeBin, name), 0o755);
  }
  process.env.PATH = `${fakeBin}:${originalPath}`;
  const run = async (provider: 'claude' | 'codex', fullAccess: boolean) => JSON.parse((await runAi({ ...request, provider,
    fullAccess, workingDirectory: fakeBin })).reply) as { args: string[]; cwd: string; prompt: string };
  const claude = await run('claude', true);
  expect(claude.args).toContain('--dangerously-skip-permissions');
  expect(claude.args).not.toContain('--tools');
  expect(await realpath(claude.cwd)).toBe(await realpath(fakeBin));
  expect(claude.prompt).toContain('full access');
  const codex = await run('codex', true);
  expect(codex.args).toContain('--dangerously-bypass-approvals-and-sandbox');
  expect(codex.args).not.toContain('--sandbox');
  expect(await realpath(codex.cwd)).toBe(await realpath(fakeBin));
  // Without full access the working directory setting is ignored.
  const limited = await run('claude', false);
  expect(limited.args).not.toContain('--dangerously-skip-permissions');
  expect(limited.args[limited.args.indexOf('--tools') + 1]).toBe('');
  expect(limited.cwd).toMatch(/zoomflow-ai-(?!test-)/);
  expect((await run('codex', false)).args).toContain('read-only');
  await expect(runAi({ ...request, provider: 'claude', fullAccess: true, workingDirectory: join(fakeBin, 'missing') }))
    .rejects.toThrow('does not exist or is not a directory');
});

it('runs Claude Code and reads structured output', async () => {
  await fakeCommand('claude', { is_error: false, structured_output: { reply: 'Renamed.', source: 'new: New' } }, 0,
    { CLAUDE_CONFIG_DIR: join(homedir(), '.claude') });
  await expect(runAi({ ...request, provider: 'claude' })).resolves.toEqual({ reply: 'Renamed.', source: 'new: New' });
});

it('accepts a large source although Claude Code prints the reply twice', async () => {
  const source = Array.from({ length: 5_000 }, (_, i) => `\t"node ${i}": "a \\"quoted\\" label"`).join('\n');
  expect(source.length).toBeLessThan(180_000);
  const answer = { reply: 'Done.', source };
  await fakeCommand('claude', { is_error: false, result: JSON.stringify(answer), structured_output: answer });
  await expect(runAi({ ...request, provider: 'claude' })).resolves.toEqual(answer);
});

it('passes custom environment and lets the Claude config field take precedence', async () => {
  await fakeCommand('claude', { is_error: false, structured_output: { reply: 'Done.', source: null } }, 0,
    { CLAUDE_CONFIG_DIR: join(homedir(), 'other-claude'), TEST_VALUE: 'one=two', EMPTY_VALUE: '' });
  await expect(runAi({ ...request, provider: 'claude', claudeConfigDir: '~/other-claude',
    environment: '# comment\nTEST_VALUE=one=two\nEMPTY_VALUE=\nCLAUDE_CONFIG_DIR=/ignored' }))
    .resolves.toEqual({ reply: 'Done.', source: null });
});

it('a blank Claude config field keeps the Environment or server value, resolved from the launch folder', async () => {
  const reply = { is_error: false, structured_output: { reply: 'Done.', source: null } };
  await fakeCommand('claude', reply, 0, { CLAUDE_CONFIG_DIR: join(homedir(), '.claude') });
  await expect(runAi({ ...request, provider: 'claude', claudeConfigDir: ' ' })).resolves.toEqual({ reply: 'Done.', source: null });
  process.env.CLAUDE_CONFIG_DIR = 'server-claude';
  process.env.INIT_CWD = '/launch';
  await fakeCommand('claude', reply, 0, { CLAUDE_CONFIG_DIR: '/launch/server-claude' });
  await expect(runAi({ ...request, provider: 'claude', claudeConfigDir: '' })).resolves.toEqual({ reply: 'Done.', source: null });
  await fakeCommand('claude', reply, 0, { CLAUDE_CONFIG_DIR: '/launch/from-field' });
  await expect(runAi({ ...request, provider: 'claude', environment: 'CLAUDE_CONFIG_DIR=from-field' })).resolves.toEqual({ reply: 'Done.', source: null });
  await fakeCommand('claude', reply, 0, { CLAUDE_CONFIG_DIR: '/launch/relative' });
  await expect(runAi({ ...request, provider: 'claude', claudeConfigDir: 'relative' })).resolves.toEqual({ reply: 'Done.', source: null });
});

it('runs Codex and accepts an answer without a source change', async () => {
  await fakeCommand('codex', { reply: 'This is the checkout board.', source: null }, 0, { TEST_VALUE: 'codex' });
  await expect(runAi({ ...request, provider: 'codex', environment: 'TEST_VALUE=codex' }))
    .resolves.toEqual({ reply: 'This is the checkout board.', source: null });
});

it('rejects malformed environment lines before starting a CLI', async () => {
  await expect(runAi({ ...request, provider: 'codex', environment: 'bad name=value' }))
    .rejects.toThrow('Environment line 1 must be NAME=value.');
  await expect(runAi({ ...request, provider: 'claude', claudeConfigDir: '~other' }))
    .rejects.toThrow('CLAUDE_CONFIG_DIR supports ~ or ~/ for the home directory.');
});

it('reports CLI failure and malformed output', async () => {
  await fakeCommand('codex', 'Authentication failed', 1);
  await expect(runAi({ ...request, provider: 'codex' })).rejects.toThrow('codex failed: Authentication failed');
  await fakeCommand('codex', 'not JSON');
  await expect(runAi({ ...request, provider: 'codex' })).rejects.toThrow();
  // Claude Code exits 1 for an error result but still prints its envelope; show only its message.
  await fakeCommand('claude', { type: 'result', is_error: true, result: 'Credit balance is too low' }, 1);
  await expect(runAi({ ...request, provider: 'claude' })).rejects.toThrow(/^claude failed: Credit balance is too low$/);
});

it('names a provider CLI that cannot start', async () => {
  fakeBin = await mkdtemp(join(tmpdir(), 'zoomflow-ai-test-'));
  // Not executable, and alone on PATH so the lookup cannot fall through to an installed claude.
  await writeFile(join(fakeBin, 'claude'), '#!/usr/bin/env node\n');
  process.env.PATH = fakeBin;
  await expect(providerStatus({ provider: 'claude' })).resolves.toEqual({ available: false, reason: 'claude could not start: EACCES.' });
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

it('stops running CLI processes when the server stops', async () => {
  fakeBin = await mkdtemp(join(tmpdir(), 'zoomflow-ai-test-'));
  const pidPath = join(fakeBin, 'pid');
  const command = join(fakeBin, 'codex');
  await writeFile(command, `#!/usr/bin/env node\nrequire('node:fs').writeFileSync(${JSON.stringify(pidPath)}, String(process.pid));\nsetInterval(() => {}, 1000);\n`);
  await chmod(command, 0o755);
  process.env.PATH = `${fakeBin}:${originalPath}`;
  const result = runAi({ ...request, provider: 'codex' });
  const rejected = expect(result).rejects.toThrow('codex failed');
  try {
    let pid = 0;
    await vi.waitFor(async () => { pid = Number(await readFile(pidPath, 'utf8')); expect(pid).toBeGreaterThan(0); }, { timeout: 10_000 });
    stopRunning();
    await rejected;
    await vi.waitFor(() => expect(() => process.kill(pid, 0)).toThrow(), { timeout: 5_000 });
  } finally { stopRunning(); }
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
    await expect(call('POST', '/api/ai/status', 'application/json')).resolves.toEqual({ status: 400, error: 'Invalid JSON request.' });
    await expect(call('PUT', '/api/ai/status', 'application/json')).resolves.toEqual({ status: 405, error: 'Use POST to check a provider.' });
    await expect(call('POST', '/api/ai', 'text/plain')).resolves.toEqual({ status: 415, error: 'Send the AI request as JSON.' });
    await expect(call('GET', '/api/ai')).resolves.toEqual({ status: 405, error: 'Send a JSON POST request.' });
  } finally { await new Promise((done) => server.close(done)); }
});

it('accepts deeply nested board ids and names the limit a request breaks', () => {
  // Board ids are full paths, so a board seven levels down passes 300 characters.
  const deep = ['root', ...Array.from({ length: 7 }, (_, i) => `layers.${'Quarterly planning topic '.repeat(2)}${i}`)].join('.');
  expect(deep.length).toBeGreaterThan(300);
  expect(requestProblem({ ...request, provider: 'codex', board: deep })).toBeUndefined();
  expect(requestProblem({ ...request, provider: 'codex', board: 'x'.repeat(8_001) })).toContain('nested too deeply');
  expect(requestProblem({ ...request, provider: 'codex', prompt: 'x'.repeat(8_001) })).toContain('prompt is too long');
  expect(requestProblem({ ...request, provider: 'codex', source: 'x'.repeat(180_001) })).toContain('diagram is too large');
  expect(requestProblem({ ...request, provider: 'codex', prompt: ' ' })).toBe('Invalid AI request.');
  expect(requestProblem({ ...request, provider: 'gpt' })).toBe('Invalid AI request.');
  // Settings fields name their limits too, rather than reading as a malformed request.
  expect(requestProblem({ ...request, provider: 'codex', name: 'x'.repeat(301) })).toContain('document name is too long');
  expect(requestProblem({ ...request, provider: 'codex', environment: 'x'.repeat(8_001) })).toContain('Environment field is too long');
  expect(requestProblem({ ...request, provider: 'claude', claudeConfigDir: 'x'.repeat(4_001) })).toContain('CLAUDE_CONFIG_DIR field is too long');
  expect(requestProblem({ ...request, provider: 'codex', workingDirectory: 'x'.repeat(4_001) })).toContain('Working directory field is too long');
  expect(requestProblem({ ...request, provider: 'codex', name: 7 })).toBe('Invalid AI request.');
});

it('names the settings field over its limit when checking a provider', async () => {
  const server = createServer((request, response) => void handle(request, response));
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const { port } = server.address() as AddressInfo;
  const check = (body: object) => new Promise<{ status: number; error: string }>((done, fail) => {
    const outgoing = httpRequest({ host: '127.0.0.1', port, method: 'POST', path: '/api/ai/status', headers: { 'Content-Type': 'application/json' } }, (incoming) => {
      let text = '';
      incoming.setEncoding('utf8');
      incoming.on('data', (chunk: string) => { text += chunk; });
      incoming.on('end', () => done({ status: incoming.statusCode ?? 0, error: (JSON.parse(text) as { error?: string }).error ?? '' }));
    });
    outgoing.on('error', fail);
    outgoing.end(JSON.stringify(body));
  });
  try {
    await expect(check({ provider: 'codex', environment: 'x'.repeat(8_001) })).resolves.toMatchObject({ status: 400, error: expect.stringContaining('Environment field is too long') });
    await expect(check({ provider: 'claude', claudeConfigDir: 'x'.repeat(4_001) })).resolves.toMatchObject({ status: 400, error: expect.stringContaining('CLAUDE_CONFIG_DIR field is too long') });
    await expect(check({ provider: 'gpt' })).resolves.toEqual({ status: 400, error: 'Invalid provider status request.' });
  } finally { await new Promise((done) => server.close(done)); }
});

it('refuses environment variables that change which programs or code the CLI loads', async () => {
  for (const name of ['PATH', 'NODE_OPTIONS', 'NODE_PATH', 'LD_PRELOAD', 'DYLD_INSERT_LIBRARIES', 'ELECTRON_RUN_AS_NODE', 'BASH_ENV', 'ENV', 'node_options',
    'GIT_DIR', 'GIT_ASKPASS', 'git_external_diff', 'SSH_ASKPASS', 'PERLLIB', 'JAVA_TOOL_OPTIONS']) {
    await expect(runAi({ ...request, provider: 'codex', environment: `SAFE=1\n${name}=/tmp/evil` }))
      .rejects.toThrow(`Environment line 2: ${name} cannot be set here`);
  }
  await expect(providerStatus({ provider: 'claude', environment: 'DYLD_LIBRARY_PATH=/tmp' })).rejects.toThrow('DYLD_LIBRARY_PATH cannot be set here');
});

it('recognizes loopback connection addresses only', () => {
  for (const address of ['127.0.0.1', '127.8.9.10', '::1', '::ffff:127.0.0.1']) expect(isLoopbackAddress(address)).toBe(true);
  for (const address of [undefined, '', '10.0.0.2', '192.168.1.5', '::ffff:192.168.1.5', 'fe80::1', '128.0.0.1']) expect(isLoopbackAddress(address)).toBe(false);
});

async function call(remoteAddress: string, host = '127.0.0.1:5173') {
  const request = Object.assign((async function* () { /* No body. */ })(), {
    method: 'GET', url: '/api/ai/status', headers: { host }, socket: { remoteAddress },
  }) as unknown as IncomingMessage;
  const { response, sent } = fakeResponse();
  await handle(request, response);
  return { status: sent.status, body: JSON.parse(sent.body ?? '{}') };
}

it('rejects remote connections even when they claim a local Host header', async () => {
  await expect(call('127.0.0.1')).resolves.toEqual({ status: 200, body: { available: true } });
  await expect(call('::ffff:127.0.0.1', 'localhost:5173')).resolves.toEqual({ status: 200, body: { available: true } });
  await expect(call('192.168.1.20')).resolves.toMatchObject({ status: 403 });
  await expect(call('127.0.0.1', 'evil.example:5173')).resolves.toMatchObject({ status: 403 });
});
