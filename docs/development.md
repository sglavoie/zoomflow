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
