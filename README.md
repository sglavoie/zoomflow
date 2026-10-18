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

Edit the D2 source in the CodeMirror pane for a live preview (350 ms debounce).
Compile errors appear in a banner and inline diagnostics while the last good
diagram stays available. Successful edits preserve the current board, falling
back to its nearest existing ancestor if it was removed. Click a shape to select
its source identifier; selecting an identifier in the editor highlights its shape
and opens its board when needed. Linked shapes still navigate; Alt+click selects
their source without navigating. Source links pause while edits are uncompiled,
so an old diagram cannot select an outdated text range. Editor keyboard shortcuts,
including undo, search, Escape and Backspace, stay in the editor.

Successful compilations also run Zoomflow lint. **Show diagnostics** opens the
editor's diagnostic list. Boundary mismatches and missing board links are errors;
unlinked layers are warnings. **Check parent backlinks** enables an additional
warning that is off by default. Lint errors do not prevent preview or export.
Use `...@zoomflow` to import the bundled boundary ports, state pieces and default
theme; see [stdlib conventions and examples](stdlib/README.md).

Use Export → Download for the current board as SVG or PNG, all boards as a ZIP
of SVGs, or one navigable HTML file. The HTML opens directly from disk without a
server or network connection and includes every board, including cyclic links.
Exports preserve the selected theme. Remote images are embedded when accessible;
failed fetches produce a placeholder and a visible warning. ZIP paths follow the
board tree (`root.svg`, `checkout.svg`, `checkout/charge.svg`); scenarios and steps
use `@scenarios/` and `@steps/` directories. PNG uses the board's native dimensions
and has a 64 megapixel limit.

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

`@zoomflow/core` provides board indexing, shape source ranges, lint, href classification, ZIP generation and
HTML packaging; `@zoomflow/viewer` provides the DOM viewer, resource embedding,
PNG rasterization and the standalone HTML navigation runtime.
D2 is pinned to the local `0.1.34-zoomflow.1` compatibility build, which fixes a
Goldmark regex initialization overflow in WebKit. [Build provenance and licenses](vendor/d2/README.md)
include the exact source, patch, tool versions and checksums. Upgrades must
deliberately review the compiler contract.
This MVP opens individual files with the bundled `zoomflow.d2` import; resolving other filesystem imports and saving edited
D2 source to disk are not yet provided. Rich HTML labels (`foreignObject`) remain unsupported.

The core API `lint(compiled, { missingBacklink: false })` accepts the D2 compile
response and returns `diagnostics`, `boundaries` (per-node expected/evaluated
counts), and `boundaryPairsEvaluated`. Diagnostics carry a rule, severity, board,
optional shape ID and optional original D2 source range. Consumers must check the
range's filename before applying it to an editor. When no local range is available,
the editor lists the board and anchors the diagnostic at the document start.
The CLI command is planned for the next session.

D2 silently strips missing shape links. The linter checks retained AST assignments
as well as compiled links to recover these. The root AST does not expand imports
or class templates: missing links supplied only by those root-level constructs
cannot currently be recovered. Child-board ASTs are expanded by D2. Boundary
checks use compiled identifiers/classes and do cover imported nodes. This
compiler limitation does not affect valid-link navigation or boundary checking.
