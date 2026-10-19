import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Plugin } from 'vite';

type Provider = 'claude' | 'codex';
type AiRequest = { provider: Provider; prompt: string; source: string; name: string; board: string;
  environment?: string; claudeConfigDir?: string };
export type AiReply = { reply: string; source: string | null };

const schema = {
  type: 'object', additionalProperties: false,
  properties: { reply: { type: 'string' }, source: { type: ['string', 'null'] } },
  required: ['reply', 'source'],
};
const MAX_REQUEST = 200_000;
const MAX_OUTPUT = 500_000;
const TIMEOUT_MS = 180_000;
const exec = promisify(execFile);

function isRequest(value: unknown): value is AiRequest {
  if (!value || typeof value !== 'object') return false;
  const item = value as Partial<AiRequest>;
  return (item.provider === 'claude' || item.provider === 'codex')
    && typeof item.prompt === 'string' && item.prompt.trim().length > 0 && item.prompt.length <= 8_000
    && typeof item.source === 'string' && item.source.length <= 180_000
    && typeof item.name === 'string' && item.name.length <= 300
    && typeof item.board === 'string' && item.board.length <= 300
    && (item.environment === undefined || (typeof item.environment === 'string' && item.environment.length <= 8_000))
    && (item.claudeConfigDir === undefined || (typeof item.claudeConfigDir === 'string' && item.claudeConfigDir.length <= 4_000));
}

function parseEnvironment(text: string): Record<string, string> {
  const entries: [string, string][] = [];
  for (const [index, line] of text.split(/\r?\n/).entries()) {
    if (!line.trim() || line.trimStart().startsWith('#')) continue;
    const equals = line.indexOf('=');
    const name = line.slice(0, equals);
    if (equals < 0 || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(name) || line.includes('\0')) {
      throw new Error(`Environment line ${index + 1} must be NAME=value.`);
    }
    entries.push([name, line.slice(equals + 1)]);
  }
  return Object.fromEntries(entries);
}

function processEnvironment(request: StatusRequest): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, ...parseEnvironment(request.environment ?? '') };
  if (request.provider === 'claude') {
    const setting = request.claudeConfigDir ?? '~/.claude';
    const path = setting.trim();
    if (!path) throw new Error('CLAUDE_CONFIG_DIR cannot be empty.');
    if (path.startsWith('~') && path !== '~' && !path.startsWith('~/')) {
      throw new Error('CLAUDE_CONFIG_DIR supports ~ or ~/ for the home directory.');
    }
    env.CLAUDE_CONFIG_DIR = path === '~' ? homedir()
      : path.startsWith('~/') ? resolve(homedir(), path.slice(2)) : resolve(process.cwd(), path);
  }
  return env;
}

type StatusRequest = Pick<AiRequest, 'provider' | 'environment' | 'claudeConfigDir'>;
function isStatusRequest(value: unknown): value is StatusRequest {
  if (!value || typeof value !== 'object') return false;
  const item = value as Partial<StatusRequest>;
  return (item.provider === 'claude' || item.provider === 'codex') &&
    (item.environment === undefined || typeof item.environment === 'string' && item.environment.length <= 8_000) &&
    (item.claudeConfigDir === undefined || typeof item.claudeConfigDir === 'string' && item.claudeConfigDir.length <= 4_000);
}

export async function providerStatus(request: StatusRequest): Promise<{ available: boolean; reason?: string }> {
  const env = processEnvironment(request);
  const command = request.provider === 'claude' ? 'claude' : 'codex';
  const args = request.provider === 'claude' ? ['auth', 'status'] : ['login', 'status'];
  try {
    const { stdout } = await exec(command, args, { env, timeout: 5_000, maxBuffer: 64_000 });
    if (request.provider === 'claude') {
      const status = JSON.parse(stdout) as { loggedIn?: boolean };
      if (status.loggedIn === true || env.ANTHROPIC_API_KEY) return { available: true };
      return { available: false, reason: 'Claude Code is installed. Sign in with claude auth login.' };
    }
    if (/^Logged in\b/im.test(stdout) || env.OPENAI_API_KEY) return { available: true };
    return { available: false, reason: 'Codex is installed. Sign in with codex login.' };
  } catch (error) {
    const failure = error as NodeJS.ErrnoException;
    if (failure.code === 'ENOENT') return { available: false, reason: `Install ${command} and add it to the local server PATH.` };
    if (failure.code === 'ETIMEDOUT') return { available: false, reason: `${command} did not respond. Check again.` };
    return { available: false, reason: `Sign in to ${command}, then check again.` };
  }
}

function instructions(request: AiRequest): string {
  return `You are helping edit a D2 diagram in Zoomflow. Answer the user's request using only the supplied diagram source. Do not access files, run commands, or use tools. Return one JSON object with exactly two fields: "reply" (a concise explanation or error) and "source" (the full replacement D2 source, or null if no change is needed or you cannot safely make it). Preserve unrelated source and working drill-down links. Do not include markdown fences. If the user asks a question without requesting a change, set source to null.\n\nDocument: ${request.name}\nCurrent board: ${request.board}\n\nCurrent D2 source:\n<d2-source>\n${request.source}\n</d2-source>\n\nUser request:\n<request>\n${request.prompt}\n</request>`;
}

function parseReply(output: string, provider: Provider): AiReply {
  let value: unknown;
  try { value = JSON.parse(output.trim()); }
  catch { throw new Error('AI returned a response that was not valid JSON.'); }
  if (provider === 'claude') {
    const envelope = value as { is_error?: boolean; result?: string; structured_output?: unknown };
    if (envelope.is_error) throw new Error(envelope.result || 'Claude Code returned an error.');
    if (envelope.structured_output !== undefined) value = envelope.structured_output;
    else {
      try { value = JSON.parse(envelope.result ?? ''); }
      catch { throw new Error('Claude Code returned a response that was not valid JSON.'); }
    }
  }
  if (!value || typeof value !== 'object') throw new Error('AI returned an invalid response.');
  const answer = value as Partial<AiReply>;
  if (typeof answer.reply !== 'string' || (answer.source !== null && typeof answer.source !== 'string')) {
    throw new Error('AI response must contain a reply and a D2 source or null.');
  }
  if (answer.source !== null && (!answer.source.trim() || answer.source.length > 180_000)) {
    throw new Error('AI returned an empty or oversized D2 source.');
  }
  return { reply: answer.reply, source: answer.source };
}

export async function runAi(request: AiRequest, signal?: AbortSignal): Promise<AiReply> {
  signal?.throwIfAborted();
  const env = processEnvironment(request);
  const directory = await mkdtemp(join(tmpdir(), 'zoomflow-ai-'));
  try {
    const schemaPath = join(directory, 'reply.schema.json');
    if (request.provider === 'codex') await writeFile(schemaPath, JSON.stringify(schema));
    const args = request.provider === 'claude'
      ? ['-p', '--tools', '', '--strict-mcp-config', '--no-session-persistence', '--output-format', 'json', '--json-schema', JSON.stringify(schema)]
      : ['exec', '--sandbox', 'read-only', '--ephemeral', '--skip-git-repo-check', '--output-schema', schemaPath, '-'];
    const command = request.provider === 'claude' ? 'claude' : 'codex';
    signal?.throwIfAborted();
    const output = await new Promise<string>((resolve, reject) => {
      const child = spawn(command, args, { cwd: directory, env, stdio: ['pipe', 'pipe', 'pipe'], shell: false,
        detached: process.platform !== 'win32' });
      let stdout = '';
      let stderr = '';
      let overflow = false;
      let timedOut = false;
      const abort = () => {
        // The CLI may have spawned subprocesses; cancel only this request's group.
        try {
          if (process.platform !== 'win32' && child.pid) process.kill(-child.pid, 'SIGKILL');
          else child.kill('SIGKILL');
        } catch { /* The process may already have exited. */ }
      };
      signal?.addEventListener('abort', abort, { once: true });
      if (signal?.aborted) abort();
      const timer = setTimeout(() => { timedOut = true; abort(); }, TIMEOUT_MS);
      child.stdout.setEncoding('utf8');
      child.stderr.setEncoding('utf8');
      child.stdout.on('data', (chunk: string) => {
        stdout += chunk;
        if (stdout.length > MAX_OUTPUT) { overflow = true; abort(); }
      });
      child.stderr.on('data', (chunk: string) => { stderr = (stderr + chunk).slice(-8_000); });
      child.on('error', (error: NodeJS.ErrnoException) => {
        clearTimeout(timer);
        signal?.removeEventListener('abort', abort);
        reject(error.code === 'ENOENT' ? new Error(`${command} is not installed or is not on the server PATH.`) : error);
      });
      child.on('close', (code) => {
        clearTimeout(timer);
        signal?.removeEventListener('abort', abort);
        if (signal?.aborted) reject(new Error('AI request canceled.'));
        else if (timedOut) reject(new Error(`${command} timed out after 3 minutes.`));
        else if (overflow) reject(new Error(`${command} returned too much output.`));
        else if (code !== 0) reject(new Error(`${command} failed: ${stderr.trim() || stdout.trim() || `exit code ${code}`}`));
        else resolve(stdout);
      });
      child.stdin.on('error', () => { /* Process errors are reported by close/error. */ });
      child.stdin.end(instructions(request));
    });
    return parseReply(output, request.provider);
  } finally { await rm(directory, { recursive: true, force: true }); }
}

function send(response: ServerResponse, status: number, data: object) {
  if (response.destroyed || response.writableEnded) return;
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  response.end(JSON.stringify(data));
}

async function handle(request: IncomingMessage, response: ServerResponse) {
  const host = request.headers.host ?? '';
  const origin = request.headers.origin;
  if (!/^(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/.test(host) || (origin && origin !== `http://${host}`)) {
    send(response, 403, { error: 'AI is available only from the local Zoomflow server.' });
    return;
  }
  if (request.url?.split('?')[0] === '/api/ai/status') {
    if (request.method === 'GET') send(response, 200, { available: true });
    else if (request.method === 'POST' && request.headers['content-type']?.startsWith('application/json')) {
      try {
        let body = '';
        for await (const chunk of request) {
          body += chunk;
          if (body.length > 16_000) { send(response, 413, { error: 'Status request is too large.' }); return; }
        }
        const payload: unknown = JSON.parse(body);
        if (!isStatusRequest(payload)) { send(response, 400, { error: 'Invalid provider status request.' }); return; }
        send(response, 200, await providerStatus(payload));
      } catch (error) { send(response, 400, { error: error instanceof Error ? error.message : String(error) }); }
    } else send(response, 405, { error: 'Use POST to check a provider.' });
    return;
  }
  if (request.method !== 'POST' || !request.headers['content-type']?.startsWith('application/json')) {
    send(response, 405, { error: 'Send a JSON POST request.' });
    return;
  }
  try {
    let body = '';
    for await (const chunk of request) {
      body += chunk;
      if (body.length > MAX_REQUEST) { send(response, 413, { error: 'Request is too large.' }); return; }
    }
    let payload: unknown;
    try { payload = JSON.parse(body); }
    catch { send(response, 400, { error: 'Invalid JSON request.' }); return; }
    if (!isRequest(payload)) { send(response, 400, { error: 'Invalid AI request.' }); return; }
    try { processEnvironment(payload); }
    catch (error) { send(response, 400, { error: error instanceof Error ? error.message : String(error) }); return; }
    const controller = new AbortController();
    const disconnect = () => controller.abort();
    response.on('close', disconnect);
    if (response.destroyed) controller.abort();
    try { send(response, 200, await runAi(payload, controller.signal)); }
    finally { response.off('close', disconnect); }
  } catch (error) {
    send(response, 500, { error: error instanceof Error ? error.message : String(error) });
  }
}

/** Local-only Vite endpoint; the static build never receives process access. */
export function aiPlugin(): Plugin {
  const middleware = (request: IncomingMessage, response: ServerResponse, next: () => void) => {
    if (!['/api/ai', '/api/ai/status'].includes(request.url?.split('?')[0] ?? '')) return next();
    void handle(request, response);
  };
  return { name: 'zoomflow-local-ai', configureServer(server) { server.middlewares.use(middleware); },
    configurePreviewServer(server) { server.middlewares.use(middleware); } };
}
