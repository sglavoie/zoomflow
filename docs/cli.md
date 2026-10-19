# Command line and CI


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

[The GitHub Actions example](../.github/workflows/diagrams.yml) installs the pinned
D2 version, lints the valid imported-boundary fixture, exports SVG ZIP and HTML,
and uploads them as artifacts. Replace the fixture paths with your own entry
files. The example demonstrates CLI use; the full root browser suite also needs
the browser installations and deliberately reviewed platform-specific PNG
baselines described in the [browser test guide](../tests/e2e/README.md).

## Application checks

The [application workflow](../.github/workflows/application.yml) runs typechecking,
unit and CLI integration tests, the production build, and the browser suite on a
pinned macOS runner. Chromium workspace screenshots cover desktop and phone layouts
in both themes, compilation errors, expanded tools, and the reference panel.
Failures upload screenshots, diffs, and traces. See [browser test guidance](../tests/e2e/README.md)
for deliberate baseline updates.

[Back to the quick start](../README.md)
