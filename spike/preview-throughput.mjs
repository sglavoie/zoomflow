// Run against pnpm dev: node spike/preview-throughput.mjs [URL] [node count]
// The baseline bypasses only the preview queue; both runs use the same real D2 compiler.
import { chromium } from '@playwright/test';

const url = process.argv[2] ?? 'http://127.0.0.1:5173';
const nodes = Number(process.argv[3] ?? 600);
/** @typedef {Window & { previewCompiles?: number }} BenchmarkWindow */
const browser = await chromium.launch();
try {
  for (const queued of [false, true]) {
    const page = await browser.newPage();
    await page.route((requestUrl) => requestUrl.pathname === '/src/document-pane.ts', async (route) => {
      const response = await route.fetch();
      let body = await response.text();
      const call = 'return previewQueue.run(() => loadPreview(source, name, preserveViewport));';
      if (!body.includes(call)) throw new Error('Update benchmark instrumentation for the current preview entry point.');
      if (!queued) body = body.replace(call, 'return loadPreview(source, name, preserveViewport);');
      body = body.replace('const compiled = await compileSource(source);', 'window.previewCompiles = (window.previewCompiles ?? 0) + 1; const compiled = await compileSource(source);');
      await route.fulfill({ response, body });
    });
    await page.goto(url);
    await page.locator('#preview-status').filter({ hasText: 'Preview ready' }).waitFor({ state: 'attached', timeout: 60_000 });
    if (!await page.evaluate(() => (/** @type {BenchmarkWindow} */ (window).previewCompiles ?? 0) > 0)) throw new Error('Compilation instrumentation did not run.');
    const result = await page.evaluate(async (nodes) => {
      const bench = /** @type {BenchmarkWindow} */ (window);
      const codemirrorView = '/node_modules/.vite/deps/@codemirror_view.js';
      const { EditorView } = await import(codemirrorView);
      const view = EditorView.findFromDOM(document.querySelector('.cm-editor'));
      const graph = Array.from({ length: nodes }, (_, i) => `n${i}: Node ${i}\nn${i} -> n${(i + 1) % nodes}`).join('\n');
      bench.previewCompiles = 0;
      let last = 0;
      for (let i = 0; i < 6; i++) {
        view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: graph + `\nlatest: Revision ${i}` } });
        last = performance.now();
        await new Promise((resolve) => setTimeout(resolve, 400));
      }
      await new Promise((resolve, reject) => {
        const deadline = Date.now() + 120_000;
        function poll() {
          if (document.querySelector('#viewer')?.getAttribute('aria-busy') === 'false' && document.querySelector('.zf-stage')?.textContent?.includes('Revision 5')) resolve(undefined);
          else if (Date.now() > deadline) reject(new Error('Preview timed out'));
          else setTimeout(poll, 10);
        }
        poll();
      });
      return { compilations: bench.previewCompiles, lastKeystrokeToPreviewMs: Math.round(performance.now() - last) };
    }, nodes);
    console.log(JSON.stringify({ queued, nodes: nodes + 1, revisions: 6, intervalMs: 400, ...result }));
    await page.close();
  }
} finally { await browser.close(); }
