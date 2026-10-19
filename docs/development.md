# Development and compiler contracts

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
can use the bundled `zoomflow.d2` import. Browser file handles are kept for the current
page session; after reload, choose a destination again to save to disk. The CLI resolves
local D2 imports within its project root. Rich HTML labels (`foreignObject`) remain unsupported.

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
as well as compiled links to recover these. The root AST does not expand imports
or class templates: missing links supplied only by those root-level constructs
cannot currently be recovered. Child-board ASTs are expanded by D2. Boundary
checks use compiled identifiers/classes and do cover imported nodes. This
compiler limitation does not affect valid-link navigation or boundary checking.


[Browser test guidance](../tests/e2e/README.md) · [Command line and CI](cli.md)
