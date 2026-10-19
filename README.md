# Zoomflow

Navigable, drill-down diagrams built on D2. The framework-free Vite app opens
local `.d2` files and starts with `fixtures/order.d2` as an example.
Click the filename dropdown to explore eight built-in templates: order drill-down,
flowchart basics, service architecture, sequence diagrams, SQL schemas, layers /
scenarios / steps, state transitions with boundary ports, and a guided lint repair.
Every example includes source comments and compiles without imports or remote
assets. The lint repair intentionally reports one error and one warning until fixed.
Switching examples starts at the root board and retains your source edits and
opened files in the dropdown for the current page session; reloading clears them.
The source lives in `apps/web/src/examples/`, with the catalog in `examples.ts`.

Use pnpm 12.6.0 and Node 26 (verified with Node 26.10.0):

```sh
pnpm install
pnpm dev
```

Click a linked shape to drill into a board. Breadcrumbs record the visited path,
trimming back to an earlier board whenever you revisit it so cycles do not repeat.
Esc or Backspace goes to the tree parent, and browser back/forward retraces your
navigation. Deep links such as `#/checkout/charge` open a board directly in the
loaded diagram. Open a file or drop one onto the page; files are compiled locally
with D2's WASM worker. Light, dark and system themes use D2's generated palettes.

Drill-down navigation needs no boundary ports or library import. Inside a child
layer, the viewer shows its parent connections (for example, **From Browse** and
**To Receipt**) using the parent's directed edges. This also works for deep links
and offline HTML. If several parent nodes open the same layer, each node's context
is listed separately. These hints do not add nodes or guess internal connections.
`layers.name` targets a child of the current board; `_` targets its parent. A missing
child link that matches an ancestor's name suggests the corresponding `_` path.

Edit the D2 source in the CodeMirror pane for a live preview (350 ms debounce).
The **AI** form above the editor can send the current source, active board, and
your prompt to either Claude Code or Codex. Start the local app with `pnpm dev`,
install and sign in to the chosen CLI, then select it and click **Send**. Zoomflow
runs `claude -p` or `codex exec` through a local Vite endpoint. A valid replacement
source becomes one undoable editor edit and updates the preview; questions can
return an answer without changing the diagram. Invalid D2 and CLI errors appear
beside the form, leaving your source untouched. If you edit or switch diagrams
while a request is running, its replacement is discarded. The AI endpoint is
available only on a local Vite dev or preview server, not in exported HTML or a
static build.
For Claude Code, the visible `CLAUDE_CONFIG_DIR` field defaults to `~/.claude`;
`~` expands to your home directory, and relative paths resolve from the server's
working directory. Both providers accept environment overrides in the shared
field, one literal `NAME=value` per line (blank lines and `#` comment lines are
ignored). Values may contain `=`. The Claude config field takes precedence over
`CLAUDE_CONFIG_DIR` in the shared field. These values are passed only to the
selected CLI process and are kept in the current page, not saved by Zoomflow.
Click **Format** or press **Shift+Alt+F** in the editor to apply D2's automatic
source formatting, including nested indentation. Formatting is one undoable edit
and refreshes the preview. Invalid diagrams leave the source unchanged and show
a formatting error; edits made while formatting is running are preserved.
Compile errors appear in a banner and inline diagnostics while the last good
diagram stays available. Successful edits preserve the current board, falling
back to its nearest existing ancestor if it was removed. Click a shape to select
its source identifier; selecting an identifier in the editor highlights its shape
and opens its board when needed. Linked shapes still navigate; Alt+click selects
their source without navigating. Source links pause while edits are uncompiled,
so an old diagram cannot select an outdated text range. Editor keyboard shortcuts,
including undo, search, Escape and Backspace, stay in the editor.

The diagram is on the left and the source editor is on the right. Click **D2
reference** or press **⌘/** (also **⌘?**) on macOS, or **Ctrl+/** (also
**Ctrl+Shift+/**) on Windows/Linux, to toggle a syntax reference below the diagram.
This shortcut also works while editing and takes precedence over CodeMirror's
comment shortcut. The bundled reference works without a network connection once
the app is loaded, with searchable examples, copy buttons and links to the full D2
documentation. Each example is tested against the bundled compiler.

Drag the horizontal divider to resize the diagram/reference split, or focus it
and use Up/Down (5% steps) and Home/End (25%/75%). The split starts at 60% diagram
and 40% reference and remembers your size when browser storage is available.
Closing and reopening preserves the search and scroll position. Escape inside the
reference closes it and restores focus without navigating the diagram. On narrow
screens, the diagram and reference appear above the source editor.

Successful compilations also run Zoomflow lint. **Show diagnostics** opens the
editor's diagnostic list. Missing board links are errors; unlinked layers are
warnings. **Check boundary ports** opts into explicit `zf-in`/`zf-out` validation;
boundary mismatches in layers that declare ports are errors only when this is
enabled. Port-free layers remain valid. **Check parent backlinks** enables an
additional warning that is off by default. Lint errors do not prevent preview or export.
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

The viewer and browser/CLI exports use the same shipped Source Sans Pro Regular,
Bold, Italic and Semibold fonts, with embedded font subsets in SVG and HTML.
See [font assets, license and renderer wiring](fonts/README.md).

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
The browser opens individual files with the bundled `zoomflow.d2` import; resolving other filesystem imports and saving edited
D2 source to disk are not yet provided in the browser. The CLI resolves local D2 imports within its project root. Rich HTML labels (`foreignObject`) remain unsupported.

The core API `lint(compiled, { missingBacklink: false, boundaryPorts: false })` accepts the D2 compile
response and returns `diagnostics`, `boundaries` (per-node expected/evaluated
counts), and `boundaryPairsEvaluated`. Boundary checking is off by default, returning
an empty `boundaries` array and zero evaluated pairs; set `boundaryPorts: true` to
validate explicit ports in layers that declare them. `parentContext(board, boards)`
exposes inferred parent connections independently of lint. Diagnostics carry a
rule, severity, board,
optional shape ID and optional original D2 source range. Consumers must check the
range's filename before applying it to an editor. When no local range is available,
the editor lists the board and anchors the diagnostic at the document start.

D2 silently strips missing shape links. The linter checks retained AST assignments
as well as compiled links to recover these. The root AST does not expand imports
or class templates: missing links supplied only by those root-level constructs
cannot currently be recovered. Child-board ASTs are expanded by D2. Boundary
checks use compiled identifiers/classes and do cover imported nodes. This
compiler limitation does not affect valid-link navigation or boundary checking.

## Command line and CI

Install [D2 v0.9.0](https://d2lang.com/tour/install/) on `PATH` for headless
exports (`brew install d2` on macOS), then build the CLI:

```sh
pnpm install --frozen-lockfile
pnpm --filter cli build
pnpm zoomflow lint fixtures/lint/imported.d2 --boundary-ports
pnpm zoomflow export fixtures/order.d2 --all --format svg -o artifacts/order-svg.zip
pnpm zoomflow export fixtures/order.d2 --all --format png -o artifacts/order-png.zip
pnpm zoomflow export fixtures/order.d2 --all --format html -o artifacts/order.html
```

The workspace installs the `zoomflow` executable (`pnpm exec zoomflow`);
`pnpm zoomflow` is a root-workspace shortcut. Run `pnpm zoomflow --help` for options. Rebuild after source changes.
Without `--all`, SVG/PNG exports contain only the root board. With `--all`, they
produce a ZIP using the same board paths as browser exports. HTML always includes
the whole board tree and the existing offline navigation runtime. Default outputs
sit beside the input: `file.svg`, `file.png`, `file.html`, `file-svg.zip`, or
`file-png.zip`. `-o`/`--output` sets an explicit destination, written only after
successful rendering. Existing exports at that destination are replaced.

Lint uses the pinned bundled WASM compiler and needs no native D2 installation.
Exit status is **0** for success (including warnings), **1** for lint errors,
and **2** for invalid arguments, missing input/dependencies, compilation or export
failure. `--json` prints the core lint result; `--boundary-ports` opts into explicit
port validation, and `--missing-backlink` opts into parent-backlink warnings.
Human diagnostics include rule, board, shape and the
compiler's source range when available.

Both commands snapshot `.d2` files under a project root: the working directory if
it contains the input, otherwise the input's directory. Set `--root path` to
include parent-relative imports or to narrow a large workspace. Imports must
remain within that root; hidden directories, `node_modules`, `dist`, `coverage`,
and symlinks are excluded. The bundled `zoomflow.d2` is available beside each
source file, with a local file of that name taking precedence. Export stages the
same source snapshot in a temporary directory, then runs native D2 with ELK,
asset bundling and one explicit board target at a time. Local icon/image paths resolve
from the original input directory, must remain within the project root, and are
staged alongside the sources; remote images must be accessible during export.
D2 embeds the shipped fonts and bundled assets; HTML needs no compiler or network
at viewing time. Native D2 handles PNG rendering. No Go or Bun is needed for the CLI build.

`pnpm --filter cli test` builds the executable and runs real fixture subprocesses:
valid/imported lint, error exit statuses, SVG/PNG ZIP contents, safe failure, and
HTML navigation from `file://` with Chromium offline. Install the test browser
with `pnpm exec playwright install chromium`. These tests also run in the root
`pnpm test` integration gate alongside the existing unit and browser suites.

[The GitHub Actions example](.github/workflows/diagrams.yml) installs the pinned
D2 version, lints the valid imported-boundary fixture, exports SVG ZIP and HTML,
and uploads them as artifacts. Replace the fixture paths with your own entry
files. The example demonstrates CLI use; the full root browser suite also needs
the browser installations and deliberately reviewed platform-specific PNG
baselines described above.
