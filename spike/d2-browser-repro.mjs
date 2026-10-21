// Run: node spike/d2-browser-repro.mjs [chromium|firefox|webkit]
// Reproduces compiler startup independently of Vite and the Zoomflow viewer.
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { chromium, firefox, webkit } from '@playwright/test';

const require = createRequire(new URL('../packages/core/package.json', import.meta.url));
const nodeDir = process.env.D2_REPRO_NODE_DIR ?? dirname(require.resolve('@d2lang/d2'));
const files = new Map([
  ['/d2.js', [resolve(nodeDir, '../browser/index.js'), 'text/javascript']],
  ['/wasm_exec.js', [process.env.D2_REPRO_WASM_EXEC ?? resolve(nodeDir, 'wasm_exec.js'), 'text/javascript']],
  ['/d2.wasm', [process.env.D2_REPRO_WASM ?? resolve(nodeDir, 'd2.wasm'), 'application/wasm']],
]);
const explicitWorker = `
importScripts('/wasm_exec.js');
self.onunhandledrejection = event => self.postMessage({ error: String(event.reason), stack: event.reason?.stack });
self.onmessage = async () => {
  try {
    const go = new Go();
    const bytes = await (await fetch('/d2.wasm')).arrayBuffer();
    const { instance } = await WebAssembly.instantiate(bytes, go.importObject);
    const running = go.run(instance);
    running.catch(error => self.postMessage({ error: String(error), stack: error.stack }));
    if (!self.d2) return;
    const compiled = JSON.parse(await self.d2.compile(JSON.stringify({ fs: { index: 'a -> b' }, options: { layout: 'elk' } })));
    self.postMessage(compiled.error ? { error: compiled.error } : { shapes: compiled.data.diagram.shapes.length });
  } catch (error) { self.postMessage({ error: String(error), stack: error.stack }); }
};`;
const server = createServer((request, response) => {
  const file = files.get(request.url ?? '');
  if (file) { response.writeHead(200, { 'content-type': file[1] }); response.end(readFileSync(file[0])); }
  else if (request.url === '/explicit-worker.js') { response.writeHead(200, { 'content-type': 'text/javascript' }); response.end(explicitWorker); }
  else { response.writeHead(200, { 'content-type': 'text/html' }); response.end('<!doctype html><title>D2 startup reproducer</title>'); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(undefined)));
const url = `http://127.0.0.1:${/** @type {import('node:net').AddressInfo} */ (server.address()).port}`;
let failed = false;
try {
  for (const [name, engine] of Object.entries({ chromium, firefox, webkit })) {
    if (process.argv[2] && process.argv[2] !== name) continue;
    const browser = await engine.launch();
    try {
      for (const mode of ['package', 'explicit']) {
        if (process.env.D2_REPRO_MODE && process.env.D2_REPRO_MODE !== mode) continue;
        const page = await browser.newPage();
        let lastRegexp;
        page.on('console', message => {
          if (message.text().startsWith('D2REGEXP ')) lastRegexp = message.text().slice(9);
        });
        await page.goto(url);
        const result = await page.evaluate(async mode => {
          if (mode === 'package') {
            const d2Module = '/d2.js';
            const { D2 } = await import(d2Module);
            const d2 = new D2();
            try { return { shapes: (await d2.compile('a -> b', { layout: 'elk' })).diagram.shapes.length }; }
            catch (error) { return { error: String(error) }; }
            finally { await d2.dispose?.(); }
          }
          return new Promise(resolve => {
            const worker = new Worker('/explicit-worker.js');
            const timer = setTimeout(() => { worker.terminate(); resolve({ error: 'startup timed out' }); }, 15000);
            worker.onmessage = ({ data }) => { clearTimeout(timer); worker.terminate(); resolve(data); };
            worker.onerror = event => { clearTimeout(timer); worker.terminate(); resolve({ error: event.message }); };
            worker.postMessage('compile');
          });
        }, mode);
        if (result.error && lastRegexp) result.lastRegexp = lastRegexp;
        if (result.stack) result.stack = result.stack.split('\n').slice(0, 6).join('\n');
        console.log(JSON.stringify({ browser: name, version: browser.version(), mode, ...result }));
        if (result.error || result.shapes !== 2) failed = true;
        await page.close();
      }
    } finally { await browser.close(); }
  }
} finally { await new Promise(resolve => server.close(resolve)); }

if (failed) process.exitCode = 1;
