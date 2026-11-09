# Development and compiler contracts

```sh
pnpm test:unit
pnpm test:e2e
pnpm typecheck
pnpm lint
pnpm build
```

`pnpm test` runs unit tests followed by browser tests. Playwright covers Chromium,
Firefox and WebKit; install them with `pnpm exec playwright install` if needed. Browser
tests run against the Vite dev server locally. In CI, and locally with
`ZOOMFLOW_PRODUCTION_E2E=1` after `pnpm build`, they load the built app through
`vite preview` instead, and a `production` project adds a smoke test of the bundle.
`pnpm lint` runs Biome's linter (formatting is not enforced; see `biome.jsonc`). Node
26 is required; `.node-version` pins the version CI uses.
The app build is written to `apps/web/dist`. D2 is loaded lazily, but its bundled
compiler is still a large download (roughly 8.5 MB gzip).

The untouched `order.d2` starter shows a small, static root-board SVG while D2
downloads. It is labelled as an example preview and is removed when the live
preview arrives, the source changes, or startup fails. Other documents, saved
export choices and non-root routes do not show it. The light and dark SVG assets
in `apps/web/src/order-preview*.svg` are current-board SVG exports of `apps/web/src/examples/order.d2` in light and dark
mode. Regenerate both through Export → Current board image (SVG) if the starter changes.

To measure cold loading, see `spike/first-preview.mjs`. On this Mac, against the
local production preview at 10 Mbps and 40 ms latency, the pre-change median of
three fresh-context runs was 8.36 seconds to a live preview. The D2 chunk ended
near 7.26 seconds and fonts near 8.06 seconds. With the starter image, the image
transfer ended near 0.40 seconds and a screenshot at 1 second showed the diagram;
the live preview still took 8.33 seconds. These figures describe this test setup,
not a guarantee for the public site. Fetching fonts in parallel with D2 increased
the live-preview median to 9.08 seconds under the same throttle because the requests
shared bandwidth, so that experiment was not retained.

Preview requests run serially with one replaceable pending request. Source changes
invalidate pending requests immediately, including during debounce; an already-running
compilation finishes but cannot publish stale output. Formatting and AI validation
retain their independent revision checks. After 15 seconds of compile/render work,
the UI offers an explicit engine restart. Restart disposes the old D2 instance,
releases queue callers, and invalidates old results before compiling the latest
source. It does not restart slow work automatically.

Editing a canonical project file invalidates the other pane when it shows a file
of the same project. Both panes debounce and coalesce previews, so direct and
transitive imports refresh together, including recovery from an import error.
Generated atlas maps are still redrawn on request.

Workspace project search compiles files on demand without rendering their SVGs,
publishes results incrementally, and permits one indexing compile at a time. Its
cache is keyed by project identity and all canonical project sources, including
unsaved edits: changing any source invalidates every file because of transitive
imports. Closing search, suspending a pane or switching documents abandons queued
work and ignores late results. Syntax failures affect only their file; engine
failures stop indexing and offer retry separately from source diagnostics.

Project checking also compiles one file at a time without rendering SVGs, from an
immutable snapshot of all current canonical project sources and lint options.
Once compilation finishes, lint uses the snapshot's complete board index to check
cross-file fragments independently of compile order or session navigation caches.
Compiler failures are reported per file and do not prevent other files from being
checked. Closing, cancelling or invalidating the check abandons queued work and
late output; source or option changes clear stale results and require an explicit
new check. Results never feed back into editor sources or live preview caches.

Project saves capture changed canonical sources from both panes once, then write
existing destinations sequentially through the single-file save service. Both
commands share document and file-entry locks, disk-change confirmation, write
error handling and saved baselines. A folder permission request precedes writes;
child files query the inherited grant without additional prompts. Files without
write access are skipped, with a source ZIP available instead of a series of save
dialogs. Cancellation stops queued files while the current write completes.
Saved baselines refer to the captured source, so later edits stay dirty. Recovered
copies are excluded from the batch.
Where browser Web Locks are available, the disk-change check and write hold one lock across tabs, including
new linked-file creation, so a second tab checks the file after the first tab's
write. Permission prompts and file pickers happen before that lock. A failed write
to a newly created linked file removes its incomplete disk entry when possible.

To compare sustained editing with and without preview coalescing, start `pnpm dev`
and run `node spike/preview-throughput.mjs http://127.0.0.1:5173 600` (use the actual
Vite URL). This sends six edits 400 ms apart to a generated diagram and reports
compilation count and milliseconds from the final edit to the correct preview. The
baseline bypasses only the queue in the browser response. Run without other tests
competing for CPU; results depend on the machine and diagram size.

A local Chromium run on 2026-10-19 with 1,801 nodes and six edits compiled six
revisions without coalescing versus three with it. Time from the final edit to the
correct preview fell from 5,893 ms to 3,229 ms. At 601 nodes, both runs compiled all
six revisions and took about 1,040 ms: coalescing helps when work falls behind, not
when the compiler already keeps up. These are observations, not timing test gates.

## Packages and compiler

`@zoomflow/core` provides board indexing, shape source ranges, lint, href classification, ZIP generation and
HTML packaging; `@zoomflow/viewer` provides the DOM viewer, resource embedding,
PNG rasterization and the standalone HTML navigation runtime.
D2 is pinned to the local `0.1.34-zoomflow.1` compatibility build, which fixes a
Goldmark regex initialization overflow in WebKit. [Build provenance and licenses](../vendor/d2/README.md)
include the exact source, patch, tool versions and checksums. Upgrades must
deliberately review the compiler contract.
Startup waits for the pinned worker’s `ready` promise (omitted from its public
types) before compiling user source. Module, worker, and font startup failures
are separate from source diagnostics and can be retried. Recheck this contract
and the startup browser tests when upgrading D2.

The browser resolves local D2 imports when a folder is opened. A single opened file
can use the bundled `zoomflow.d2` import. Browser file handles, with each file's last known
modification time, are kept per draft in IndexedDB (`file-handles.ts`), so Save writes back
after a reload once the browser grants write permission again; browsers that cannot store
handles keep them for the page session only. The CLI resolves
local D2 imports within its project root. Markdown labels render as native SVG text, but
Markdown images are dropped and rich HTML labels (`foreignObject`) remain unsupported.

Drafts also carry versioned, serialized view metadata: explicit export visibility
choices and connected-layer settings. Keeping it as a primitive makes the draft
store's shallow revision snapshots independent. Metadata-only changes participate
in browser backup and concurrent recovery without dirtying D2 source. The viewer's
injected view adapter reads canonical draft choices for every exported project file,
so atlas exports include choices from either pane and files not mounted since reload.
Layer settings are saved after a successful render; invalid metadata is ignored
without blocking source recovery. Missing shapes and boards are ignored for visibility
while retaining their choices for undo; a missing layer root falls back to an existing board.

Editable project archives (`.zoomflow.zip`) contain a `zoomflow.json` manifest with
`format: "zoomflow-project"`, `version: 1`, a project `name`, an `entry` file path,
and `files: [{ path, view? }]`. Each source is stored as UTF-8 at `sources/<path>`;
`view` is the viewer's versioned serialized string. Core validates the whole archive,
relative paths, uniqueness, required sources and entry before the host changes drafts.
ZIP expansion is bounded to 64 MiB and projects to 10,000 files. The web host normalizes
view metadata with the existing viewer parser and installs it before the first render.
Imports always create an independent project without disk handles. Snapshots synchronize
both panes and include all canonical sources; a selected recovered copy replaces only
its own path in the archive. The generated atlas map is replaced by its opener.
Source ZIPs and `.d2` disk saves retain their source-only contract.

## Upstream branch moves

Builder flows reparent through their lossless flow model. Other graphs preserve the
original source and append native D2 edge deletions and new connections, inside the
nearest local board block. `BoardSites.append` keeps overrides inside attachment
bodies so their parents remain editable builders. Imported and inherited boards can
receive local overrides. Source revisions guard both the picker and active drags.

`graph-branches.ts` pairs compiled diagram connections with serialized graph edges
in compiler order. It reads raw arrow-direction booleans, authored style values,
arrowhead attributes and SQL-column indexes there. Copied class names remain, while
style values and labels are snapshots of the resolved connection. Theme defaults
are left to the compiler. File links use the host's rebased hrefs. Parallel D2
selectors count each column endpoint pair separately, whereas rendered connection
IDs count all arrows between those tables; deletions therefore use column-aware
ordinals in descending order. Compiler tests cover these contracts, along with
quoted names, Markdown, imports, merges, loops and board inheritance.

`board-transfers.ts` owns cross-board transactions for builder flows and mind maps.
It cuts model objects by identity, moves their attachment trees, and serializes the
document once. A transferred branch retains its builder in an attached board; an
occupied destination gets a new child without replacing its existing link. Physical
board declaration ranges also allow moving builders nested in hand-written layers.
Generated detail centres resolve to their logical topic, and destination checks walk
attachment ownership to reject cycles across boards. Shape and board remaps carry
export visibility and layer choices through renumbering and relocation. The viewer
applies those choices after compilation, under the replacement document's draft key;
undo and redo retain view snapshots with the source transaction.

## File links and atlas routes

A file link is classified by `classifyHref` as `{ kind: 'file', path, hash }` when it is
a `./` or `../` path ending in `.d2`, optionally followed by a `#/…` fragment;
`resolveFilePath(fromPath, path)` turns it into a project path or `undefined` above the
root. Both are self-contained because the offline runtime serializes them. A spike
against the pinned `0.1.34-zoomflow.1` compiler, pinned in
`packages/core/test/d2-contract.test.ts`, showed what D2 keeps:

| Authored link | Compiled `shape.link` |
| --- | --- |
| `link: ./health.d2` | `./health.d2` |
| `link: "./health.d2#/Sleep/Night"` | `./health.d2#/Sleep/Night` |
| `link: "../other.d2"` (inside a layer) | `../other.d2` |
| `link: "./My Life.d2"` | `./My Life.d2` |
| `link: health.d2` / `link: "health.d2"` | `""` (silently dropped: read as a board path) |
| `link: "work/plan.d2"` | `""` (silently dropped) |

Rendered SVG anchors carry the compiled value verbatim. Lint recovers dropped bare
links from the AST (`bare-file-link`), the same way it recovers missing board links.
Recheck this table when upgrading D2.

Atlas routes: the entry file keeps its usual routes (`#/`, `#/Board`); every other file
uses `#/@file/<encodeURIComponent(path)>` followed by its own board segments, for
example `#/@file/health.d2/Sleep`. `@` already marks `@scenarios` and `@steps`, and
literal board names are percent-encoded, so `@file` cannot collide with a board name.
`atlasHash(path, boardHash)` and `parseAtlasHash(hash)` in core build and read these
routes. Atlas HTML carries a second JSON script, `#zoomflow-files` (`[{ path, name }]`),
and its runtime follows file links only when that script exists. Atlas ZIPs put other
files under `@files/<path>/`. SVG ZIP links point to each target board's SVG, including
file links with board fragments; missing boards fall back to their nearest exported ancestor.
The web app's atlas map (`apps/web/src/atlas-map.ts`) is
generated D2 compiled as the project root's `index`, so its links are `./<path>`.

## Source locations and lint contracts

The core API `lint(compiled, { missingBacklink: false, boundaryPorts: false })` accepts the D2 compile
response and returns `diagnostics`, `boundaries` (per-node expected/evaluated
counts), and `boundaryPairsEvaluated`. Boundary checking is off by default, returning
an empty `boundaries` array and zero evaluated pairs; set `boundaryPorts: true` to
validate explicit ports in layers that declare them. `parentContext(board, boards)`
exposes inferred parent connections independently of lint. Diagnostics carry a
rule, severity, board,
optional shape ID and optional original D2 source range. Consumers must check the
range's filename before applying it to an editor. The editor keeps foreign file locations separate from local ranges. Diagnostics
without a usable source location remain in the list without a misleading line-1 marker.

D2 silently strips missing shape links. The linter checks retained AST assignments
as well as compiled links to recover these. The root AST keeps imports, globs and
class templates unexpanded, and child-board ASTs hold links D2 already resolved, so
lint also reads links from the source text: imported files at each shape's reference,
glob statements with their `&` filters (evaluated against the compiled attributes, as
D2 does), and class definitions, resolved from the board that defines the class.
Substituted board links, which D2 always drops, are reported as such. Boundary
checks use compiled identifiers/classes and do cover imported nodes.


[Browser test guidance](../tests/e2e/README.md) · [Command line and CI](cli.md)
