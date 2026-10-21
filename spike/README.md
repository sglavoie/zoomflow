# Spikes

Standalone investigation scripts. They are not part of the test suite and are run by hand
from the repository root.

- `d2-browser-repro.mjs` reproduces the WebKit D2 startup failure that the pinned
  compatibility build fixes. See [d2-browser-repro.md](d2-browser-repro.md).
- `preview-throughput.mjs` measures sustained-editing preview latency with and without
  preview coalescing against `pnpm dev`. See [Development](../docs/development.md).
  It instruments `apps/web/src/document-pane.ts` by source text and fails loudly when
  that code changes.
