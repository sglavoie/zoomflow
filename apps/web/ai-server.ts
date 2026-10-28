import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Plugin, PreviewServer, ViteDevServer } from 'vite';

type Provider = 'claude' | 'codex';
type AiRequest = { provider: Provider; prompt: string; source: string; name: string; board: string;
  environment?: string; claudeConfigDir?: string; fullAccess?: boolean; workingDirectory?: string };
export type AiReply = { reply: string; source: string | null };

const schema = {
  type: 'object', additionalProperties: false,
  properties: { reply: { type: 'string' }, source: { type: ['string', 'null'] } },
  required: ['reply', 'source'],
};
// Request limits count UTF-8 bytes. They leave room for the field limits below in characters:
// non-ASCII source can take up to three bytes per character, and JSON escaping adds more.
const MAX_REQUEST = 1_000_000;
const MAX_STATUS_REQUEST = 64_000;
const MAX_OUTPUT = 500_000;
const TIMEOUT_MS = 180_000;
/** Full access lets the CLI read files and run commands, which takes longer than answering from the source alone. */
const FULL_ACCESS_TIMEOUT_MS = 600_000;
const exec = promisify(execFile);

/** Requests still running; detached CLIs do not receive the terminal's Ctrl+C, so the server stops them itself. */
const running = new Set<ChildProcess>();
function kill(child: ChildProcess) {
  // The CLI may have spawned subprocesses; stop this request's whole group.
  try {
    if (process.platform !== 'win32' && child.pid) process.kill(-child.pid, 'SIGKILL');
    else child.kill('SIGKILL');
  } catch { /* The process may already have exited. */ }
}
/** Stop every running CLI; exported for tests. */
export function stopRunning() {
  for (const child of running) kill(child);
  running.clear();
}
let exitHooked = false;
function stopOnExit() {
  if (exitHooked) return;
  exitHooked = true;
  process.once('exit', stopRunning);
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, () => {
      stopRunning();
      // Without other listeners, adding ours replaced the default exit; restore it.
      if (process.listenerCount(signal) === 0) process.kill(process.pid, signal);
    });
  }
}

const optionalText = (value: unknown, limit: number) => value === undefined || typeof value === 'string' && value.length <= limit;

type StatusRequest = Pick<AiRequest, 'provider' | 'environment' | 'claudeConfigDir'>;
function isStatusRequest(value: unknown): value is StatusRequest {
  if (!value || typeof value !== 'object') return false;
  const item = value as Partial<StatusRequest>;
  return (item.provider === 'claude' || item.provider === 'codex')
    && optionalText(item.environment, 8_000) && optionalText(item.claudeConfigDir, 4_000);
}

/** Why the AI settings that both requests send cannot be used, naming the field over its limit. */
function settingsProblem(value: unknown): string | undefined {
  const item = (value && typeof value === 'object' ? value : {}) as Partial<StatusRequest>;
  if (typeof item.environment === 'string' && item.environment.length > 8_000) return 'The Environment field is too long. Keep it under 8,000 characters, then try again.';
  if (typeof item.claudeConfigDir === 'string' && item.claudeConfigDir.length > 4_000) return 'The CLAUDE_CONFIG_DIR field is too long. Keep it under 4,000 characters, then try again.';
  return undefined;
}

/** Why the page's request cannot run, naming what to change when it is a size limit; undefined when it can run.
 * Board ids are full paths (`root.layers.a.layers.b…`), so deep boards need far more than a name's length. */
export function requestProblem(value: unknown): string | undefined {
  const settings = settingsProblem(value);
  if (settings) return settings;
  if (!isStatusRequest(value)) return 'Invalid AI request.';
  const item = value as Partial<AiRequest>;
  if (typeof item.name === 'string' && item.name.length > 300) return 'The document name is too long for AI. Use a name under 300 characters, then try again.';
  if (typeof item.workingDirectory === 'string' && item.workingDirectory.length > 4_000) return 'The Working directory field is too long. Keep it under 4,000 characters, then try again.';
  if (typeof item.prompt === 'string' && item.prompt.length > 8_000) return 'The prompt is too long. Keep it under 8,000 characters, then try again.';
  if (typeof item.source === 'string' && item.source.length > 180_000) return 'The diagram is too large for AI. Keep it under 180,000 characters, then try again.';
  if (typeof item.board === 'string' && item.board.length > 8_000) return 'The current board is nested too deeply for AI. Open a board nearer the top, then try again.';
  return typeof item.prompt === 'string' && item.prompt.trim().length > 0 && typeof item.source === 'string'
    && typeof item.name === 'string' && item.name.length <= 300 && typeof item.board === 'string'
    && (item.fullAccess === undefined || typeof item.fullAccess === 'boolean') && optionalText(item.workingDirectory, 4_000)
    ? undefined : 'Invalid AI request.';
}

/** Variables that load code or change which programs run would let a page run arbitrary commands. Every `GIT_*`
 * variable is refused, since several (`GIT_DIR`, `GIT_ASKPASS`, `GIT_EXTERNAL_DIFF`) can point Git at a command. */
const BLOCKED_ENVIRONMENT = new Set(['PATH', 'NODE_OPTIONS', 'NODE_PATH', 'NODE_REPL_EXTERNAL_MODULE', 'ELECTRON_RUN_AS_NODE',
  'BASH_ENV', 'ENV', 'SHELL', 'SHELLOPTS', 'BASHOPTS', 'PS4', 'PROMPT_COMMAND', 'IFS', 'CDPATH', 'HOME', 'ZDOTDIR',
  'PYTHONPATH', 'PYTHONSTARTUP', 'PYTHONHOME', 'PERL5LIB', 'PERLLIB', 'PERL5OPT', 'RUBYLIB', 'RUBYOPT', 'JAVA_TOOL_OPTIONS',
  'SSH_ASKPASS', 'EDITOR', 'VISUAL', 'PAGER', 'BROWSER', 'COMSPEC', 'PATHEXT']);
export const blockedEnvironmentName = (name: string) => {
  const upper = name.toUpperCase();
  return BLOCKED_ENVIRONMENT.has(upper) || /^(LD_|DYLD_|BASH_FUNC_|GIT_)/.test(upper) || upper.startsWith('NPM_CONFIG_');
};

function parseEnvironment(text: string): Record<string, string> {
  const entries: [string, string][] = [];
  for (const [index, line] of text.split(/\r?\n/).entries()) {
    if (!line.trim() || line.trimStart().startsWith('#')) continue;
    const equals = line.indexOf('=');
    const name = line.slice(0, equals);
    if (equals < 0 || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(name) || line.includes('\0')) {
      throw new Error(`Environment line ${index + 1} must be NAME=value.`);
    }
    if (blockedEnvironmentName(name)) {
      throw new Error(`Environment line ${index + 1}: ${name} cannot be set here because it changes which programs or code the CLI loads. Set it in the shell that starts the local server instead.`);
    }
    entries.push([name, line.slice(equals + 1)]);
  }
  return Object.fromEntries(entries);
}

/** Expand `~` to the home directory and resolve relative paths from `base`. */
function expandPath(setting: string, label: string, base: string) {
  const path = setting.trim();
  if (!path) throw new Error(`${label} cannot be empty.`);
  if (path.startsWith('~') && path !== '~' && !path.startsWith('~/')) {
    throw new Error(`${label} supports ~ or ~/ for the home directory.`);
  }
  return path === '~' ? homedir() : path.startsWith('~/') ? resolve(homedir(), path.slice(2)) : resolve(base, path);
}

/** pnpm and npm record where `pnpm dev` was typed, usually the repository root rather than apps/web. */
const launchDirectory = () => process.env.INIT_CWD || process.cwd();

/** A blank CLAUDE_CONFIG_DIR field keeps the value from the Environment field or the server, else ~/.claude. */
function processEnvironment(request: StatusRequest): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, ...parseEnvironment(request.environment ?? '') };
  if (request.provider === 'claude') {
    const setting = request.claudeConfigDir?.trim() || env.CLAUDE_CONFIG_DIR?.trim() || '~/.claude';
    env.CLAUDE_CONFIG_DIR = expandPath(setting, 'CLAUDE_CONFIG_DIR', launchDirectory());
  }
  return env;
}

/** The directory a full-access request works in: the setting, or where the local server was started. */
export async function workingDirectory(setting: string | undefined) {
  const path = setting?.trim() ? expandPath(setting, 'Working directory', launchDirectory()) : launchDirectory();
  const info = await stat(path).catch(() => undefined);
  if (!info?.isDirectory()) throw new Error(`Working directory ${path} does not exist or is not a directory.`);
  return path;
}

export async function providerStatus(request: StatusRequest): Promise<{ available: boolean; reason?: string }> {
  const env = processEnvironment(request);
  const command = request.provider === 'claude' ? 'claude' : 'codex';
  const args = request.provider === 'claude' ? ['auth', 'status'] : ['login', 'status'];
  let stdout: string;
  let stderr: string;
  try { ({ stdout, stderr } = await exec(command, args, { env, timeout: 5_000, maxBuffer: 64_000 })); }
  catch (error) {
    // Signed-out CLIs exit 1 but still print their status; a timeout kills the process instead.
    const failure = error as NodeJS.ErrnoException & { killed?: boolean; stdout?: string; stderr?: string };
    if (failure.code === 'ENOENT') return { available: false, reason: `Install ${command} and add it to the local server PATH.` };
    if (failure.killed || failure.code === 'ETIMEDOUT') return { available: false, reason: `${command} did not respond. Check again.` };
    // Exit statuses are numbers; a string code means the command never ran, for example EACCES.
    if (typeof failure.code === 'string') return { available: false, reason: `${command} could not start: ${failure.code}.` };
    stdout = failure.stdout ?? '';
    stderr = failure.stderr ?? '';
  }
  if (request.provider === 'claude') {
    let status: { loggedIn?: boolean } = {};
    try { status = JSON.parse(stdout) as { loggedIn?: boolean }; } catch { /* Unknown output counts as signed out. */ }
    if (status.loggedIn === true || env.ANTHROPIC_API_KEY) return { available: true };
    return { available: false, reason: 'Claude Code is installed. Sign in with claude auth login.' };
  }
  // Codex prints its login status to stderr.
  if (/^Logged in\b/im.test(`${stdout}\n${stderr}`) || env.OPENAI_API_KEY) return { available: true };
  return { available: false, reason: 'Codex is installed. Sign in with codex login.' };
}

function instructions(request: AiRequest, directory?: string): string {
  const access = directory
    ? `You have full access to this computer: you may read files, run commands, and use tools to gather what the request needs, starting in the working directory ${directory}. Do not write the diagram to a file yourself; return any diagram change in the JSON reply.`
    : 'Answer the user\'s request using only the supplied diagram source. Do not access files, run commands, or use tools.';
  return `You are helping edit a D2 diagram in Zoomflow. ${access} Return one JSON object with exactly two fields: "reply" (a concise explanation or error) and "source" (the full replacement D2 source, or null if no change is needed or you cannot safely make it). Preserve unrelated source and working drill-down links. Do not include markdown fences. If the user asks a question without requesting a change, set source to null.\n\nDocument: ${request.name}\nCurrent board: ${request.board}\n\nCurrent D2 source:\n<d2-source>\n${request.source}\n</d2-source>\n\nUser request:\n<request>\n${request.prompt}\n</request>`;
}

/** Claude Code exits non-zero for an error result but still prints its JSON envelope; keep only its message. */
function claudeError(output: string) {
  try {
    const envelope = JSON.parse(output.trim()) as { is_error?: boolean; result?: unknown };
    return envelope.is_error && typeof envelope.result === 'string' && envelope.result.trim() ? envelope.result.trim() : undefined;
  } catch { return undefined; }
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
  const cwd = request.fullAccess ? await workingDirectory(request.workingDirectory) : undefined;
  signal?.throwIfAborted();
  const directory = await mkdtemp(join(tmpdir(), 'zoomflow-ai-'));
  try {
    const schemaPath = join(directory, 'reply.schema.json');
    if (request.provider === 'codex') await writeFile(schemaPath, JSON.stringify(schema));
    // Leave out the user's own CLI settings (hooks, plugins, instructions); sign-in still applies.
    // Full access replaces the tool-less or read-only mode with one that skips every permission check.
    const args = request.provider === 'claude'
      ? ['-p', ...(cwd ? ['--dangerously-skip-permissions'] : ['--tools', '']), '--setting-sources', '', '--strict-mcp-config', '--no-session-persistence', '--output-format', 'json', '--json-schema', JSON.stringify(schema)]
      : ['exec', ...(cwd ? ['--dangerously-bypass-approvals-and-sandbox'] : ['--sandbox', 'read-only']), '--ephemeral', '--ignore-user-config', '--skip-git-repo-check', '--output-schema', schemaPath, '-'];
    const timeout = cwd ? FULL_ACCESS_TIMEOUT_MS : TIMEOUT_MS;
    const command = request.provider === 'claude' ? 'claude' : 'codex';
    signal?.throwIfAborted();
    const output = await new Promise<string>((resolve, reject) => {
      const child = spawn(command, args, { cwd: cwd ?? directory, env, stdio: ['pipe', 'pipe', 'pipe'], shell: false,
        detached: process.platform !== 'win32' });
      let stdout = '';
      let stderr = '';
      let overflow = false;
      let timedOut = false;
      running.add(child);
      const abort = () => kill(child);
      signal?.addEventListener('abort', abort, { once: true });
      if (signal?.aborted) abort();
      const timer = setTimeout(() => { timedOut = true; abort(); }, timeout);
      child.stdout.setEncoding('utf8');
      child.stderr.setEncoding('utf8');
      child.stdout.on('data', (chunk: string) => {
        stdout += chunk;
        if (stdout.length > MAX_OUTPUT) { overflow = true; abort(); }
      });
      child.stderr.on('data', (chunk: string) => { stderr = (stderr + chunk).slice(-8_000); });
      child.on('error', (error: NodeJS.ErrnoException) => {
        clearTimeout(timer);
        running.delete(child);
        signal?.removeEventListener('abort', abort);
        reject(error.code === 'ENOENT' ? new Error(`${command} is not installed or is not on the server PATH.`) : error);
      });
      child.on('close', (code) => {
        clearTimeout(timer);
        running.delete(child);
        signal?.removeEventListener('abort', abort);
        if (signal?.aborted) reject(new Error('AI request canceled.'));
        else if (timedOut) reject(new Error(`${command} timed out after ${timeout / 60_000} minutes.`));
        else if (overflow) reject(new Error(`${command} returned too much output.`));
        else if (code !== 0) {
          const detail = (request.provider === 'claude' ? claudeError(stdout) : undefined) || stderr.trim() || stdout.trim().slice(0, 2_000);
          reject(new Error(`${command} failed: ${detail || `exit code ${code}`}`));
        }
        else resolve(stdout);
      });
      child.stdin.on('error', () => { /* Process errors are reported by close/error. */ });
      child.stdin.end(instructions(request, cwd));
    });
    return parseReply(output, request.provider);
  } finally { await rm(directory, { recursive: true, force: true }); }
}

function send(response: ServerResponse, status: number, data: object) {
  if (response.destroyed || response.writableEnded) return;
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  response.end(JSON.stringify(data));
}

const message = (error: unknown) => error instanceof Error ? error.message : String(error);

/** Read a UTF-8 request body up to `limit` bytes; answers 413 and returns undefined beyond it.
 * Chunks are joined as bytes, so a character split across chunks stays intact. */
export async function readBody(request: AsyncIterable<Buffer | string>, response: ServerResponse, limit: number, tooLarge: string) {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const bytes = typeof chunk === 'string' ? Buffer.from(chunk) : chunk;
    size += bytes.length;
    if (size > limit) { send(response, 413, { error: tooLarge }); return undefined; }
    chunks.push(bytes);
  }
  return Buffer.concat(chunks).toString('utf8');
}

const isJson = (request: IncomingMessage) => request.headers['content-type']?.startsWith('application/json') === true;

/** The connection itself comes from this computer; the Host header alone can be forged by remote clients. */
export function isLoopbackAddress(address: string | undefined) {
  if (!address) return false;
  const ipv4 = address.startsWith('::ffff:') ? address.slice(7) : address;
  return address === '::1' || /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(ipv4);
}

export async function handle(request: IncomingMessage, response: ServerResponse) {
  const host = request.headers.host ?? '';
  const origin = request.headers.origin;
  if (!isLoopbackAddress(request.socket.remoteAddress) || !/^(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/.test(host) || (origin && origin !== `http://${host}`)) {
    send(response, 403, { error: 'AI is available only from the local Zoomflow server.' });
    return;
  }
  if (request.url?.split('?')[0] === '/api/ai/status') {
    if (request.method === 'GET') send(response, 200, { available: true });
    else if (request.method !== 'POST') send(response, 405, { error: 'Use POST to check a provider.' });
    else if (!isJson(request)) send(response, 415, { error: 'Send JSON to check a provider.' });
    else {
      try {
        const body = await readBody(request, response, MAX_STATUS_REQUEST, 'Status request is too large.');
        if (body === undefined) return;
        let payload: unknown;
        try { payload = JSON.parse(body); }
        catch { send(response, 400, { error: 'Invalid JSON request.' }); return; }
        if (!isStatusRequest(payload)) { send(response, 400, { error: settingsProblem(payload) ?? 'Invalid provider status request.' }); return; }
        send(response, 200, await providerStatus(payload));
      } catch (error) { send(response, 400, { error: message(error) }); }
    }
    return;
  }
  if (request.method !== 'POST') { send(response, 405, { error: 'Send a JSON POST request.' }); return; }
  if (!isJson(request)) { send(response, 415, { error: 'Send the AI request as JSON.' }); return; }
  try {
    const body = await readBody(request, response, MAX_REQUEST, 'Request is too large.');
    if (body === undefined) return;
    let payload: unknown;
    try { payload = JSON.parse(body); }
    catch { send(response, 400, { error: 'Invalid JSON request.' }); return; }
    const problem = requestProblem(payload);
    if (problem) { send(response, 400, { error: problem }); return; }
    const ai = payload as AiRequest;
    try { processEnvironment(ai); if (ai.fullAccess) await workingDirectory(ai.workingDirectory); }
    catch (error) { send(response, 400, { error: message(error) }); return; }
    const controller = new AbortController();
    const disconnect = () => controller.abort();
    response.on('close', disconnect);
    if (response.destroyed) controller.abort();
    try { send(response, 200, await runAi(ai, controller.signal)); }
    finally { response.off('close', disconnect); }
  } catch (error) {
    send(response, 500, { error: message(error) });
  }
}

/** Local-only Vite endpoint; the static build never receives process access. */
export function aiPlugin(): Plugin {
  const middleware = (request: IncomingMessage, response: ServerResponse, next: () => void) => {
    if (!['/api/ai', '/api/ai/status'].includes(request.url?.split('?')[0] ?? '')) return next();
    void handle(request, response);
  };
  const attach = (server: ViteDevServer | PreviewServer) => {
    server.middlewares.use(middleware);
    server.httpServer?.once('close', stopRunning);
    stopOnExit();
  };
  return { name: 'zoomflow-local-ai', configureServer: attach, configurePreviewServer: attach };
}
