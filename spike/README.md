# Spikes

Standalone investigation scripts. They are not part of the test suite and are run by hand
from the repository root.

- `d2-browser-repro.mjs` reproduces the WebKit D2 startup failure that the pinned
  compatibility build fixes. See [d2-browser-repro.md](d2-browser-repro.md).
- `preview-throughput.mjs` measures sustained-editing preview latency with and without
  preview coalescing against `pnpm dev`. See [Development](../docs/development.md).
  It instruments `apps/web/src/document-pane.ts` by source text and fails loudly when
  that code changes.
- `first-preview.mjs` measures a cold production load in Chromium at 390×844, with
  the cache disabled, 10 Mbps bandwidth and 40 ms network latency. Build the app,
  start `pnpm --filter @zoomflow/web preview`, then run
  `node spike/first-preview.mjs http://127.0.0.1:4173/ 3`.
  The optional fourth argument is a CPU slowdown multiplier. Each run uses a new
  browser context and prints the first live-preview time and resource timeline.
  `starterSvgLoadedMs` is the time the lightweight starter image finished loading,
  not a paint timestamp. The Vite preview server and GitHub Pages may compress
  assets differently, so compare changes on the same server and machine.
