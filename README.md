# Zoomflow

Navigable, drill-down diagrams built on D2. The framework-free Vite app opens
local `.d2` files and starts with `fixtures/order.d2` as an example.

Use pnpm 12.6.0 and Node 26 (verified with Node 26.10.0):

```sh
pnpm install
pnpm dev
```

Click a linked shape to drill into a board. Breadcrumbs record visited boards;
Esc or Backspace goes to the tree parent, and browser back/forward retraces your
navigation. Deep links such as `#/checkout/charge` open a board directly in the
loaded diagram. Open a file or drop one onto the page; files are compiled locally
with D2's WASM worker. Light, dark and system themes use D2's generated palettes.

```sh
pnpm test:unit
pnpm test:e2e
pnpm typecheck
pnpm build
```

`pnpm test` runs unit tests followed by browser tests. Playwright covers Chromium,
Firefox and WebKit; install them with `pnpm exec playwright install` if needed.
The app build is written to `apps/web/dist`. D2 is loaded lazily, but its bundled
compiler is still a large download (roughly 8.5 MB gzip).

`@zoomflow/core` provides board indexing and href classification;
`@zoomflow/viewer` provides the DOM viewer with an injected async board renderer.
D2 is pinned to the local `0.1.34-zoomflow.1` compatibility build, which fixes a
Goldmark regex initialization overflow in WebKit. [Build provenance and licenses](vendor/d2/README.md)
include the exact source, patch, tool versions and checksums. Upgrades must
deliberately review the compiler contract.
This MVP opens individual files; resolving filesystem imports and editing or
exporting diagrams are not yet provided.
