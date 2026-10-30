# Command line and CI

Download the built CLI from [GitHub Releases](https://github.com/sglavoie/zoomflow/releases)
and follow the [archive instructions](releases.md#downloads), or build from source below.
The downloadable CLI needs Node.js but no pnpm or dependency installation.

Install [D2 v0.9.0](https://d2lang.com/tour/install/) on `PATH` for headless
exports (`brew install d2` on macOS), then build the CLI:

```sh
pnpm install --frozen-lockfile
pnpm --filter cli build
pnpm zoomflow lint fixtures/lint/imported.d2 --boundary-ports
pnpm zoomflow export fixtures/order.d2 --all --format svg -o artifacts/order-svg.zip
pnpm zoomflow export fixtures/order.d2 --all --format png -o artifacts/order-png.zip
pnpm zoomflow export fixtures/order.d2 --all --format html -o artifacts/order.html
pnpm zoomflow lint fixtures/atlas/index.d2 --follow
pnpm zoomflow export fixtures/atlas/index.d2 --format html -o artifacts/atlas.html
```

The workspace installs the `zoomflow` executable (`pnpm exec zoomflow`);
`pnpm zoomflow` is a root-workspace shortcut. Run `pnpm zoomflow --help` (`-h`) for
options and `--version` (`-v`) for the version. Rebuild after source changes. The
CLI requires Node.js 26 or later.
Without `--all`, SVG/PNG exports contain only the root board, and its board links,
which lead nowhere in a single file, are removed. With `--all`, they
produce a ZIP using the same board paths as browser exports; in an SVG ZIP, board
links point to the linked board's file, so the SVGs stay navigable. As in browser
exports, only `http:`, `https:` and `mailto:` links are kept besides board links;
any other link, such as `javascript:` or `data:`, loses its target. ZIP entry names keep
board names, including Unicode; only characters and names that archives or common
file systems reject (`/ \ < > : " | ? *`, control characters, trailing dots or
spaces, `.`/`..`, and Windows device names such as `CON` or `LPT1`) are replaced
with `_` or prefixed, and names that differ only by case or Unicode normalization
gain an `@` prefix; a board's child boards sit in the folder named like its own file,
so `@a_b.svg` keeps its children in `@a_b/`. HTML always includes the whole board tree, titled after the
input file without `.d2`, and a minified offline navigation runtime. **Find in diagram**
(⌘⇧F / Ctrl+Shift+F) searches board names and shape labels; atlas HTML offers
**Find in atlas** across every bundled file, with file paths in its results.
Choosing a result opens its board and frames and highlights its shape. The HTML
Content-Security-Policy allows only the inline runtime and styles and embedded
(`data:`) images and fonts, and no network requests. When two or more boards have
shapes, one extra render of their characters gives them the same font subsets, so each
face is embedded once; repeated D2 theme styles are also stored once, and empty
boards carry no SVG. Faces that render lacks, such as code fonts, stay with their board. Default outputs sit beside the input: `file.svg`, `file.png`, `file.html`,
`file-svg.zip`, or `file-png.zip`. `-o`/`--output` sets an explicit destination
whose extension must match (`.zip` with `--all` for SVG/PNG), written only after
successful rendering. Without `--format`, an `.svg`, `.png` or `.html` output
chooses the format, so `-o out.png` exports PNG; `--format` and the input's `.d2`
extension are case-insensitive. Existing exports at that destination are replaced; a
directory there is rejected before rendering (`Output is a directory`).
Exports succeed with dangling board links but print a one-line summary such as
`zoomflow: 1 dangling link (run zoomflow lint)` on stderr.

### File links and atlases

File links (`link: ./health.d2`, `link: "../index.d2#/Board"`; see the
[atlas guide](workspace.md#link-diagrams-into-an-atlas)) are checked by every lint
run: a link must open a regular `.d2` file inside `--root`, by the same rules as imports
(a symlinked target counts as missing, and so does one spelled in another letter case, such as
`./Health.d2` for `health.d2`, which case-sensitive systems would not open), and a fragment must name a board that file has.
`lint --follow` also lints every file reachable through file links, breadth first and
each once, so cycles end. Each diagnostic names its file, the summary ends `in N files`,
and `--json` adds `files` plus `file` on every diagnostic and boundary; without
`--follow` the JSON shape is unchanged. A reached file that does not compile fails the
run with exit **2**. `--follow` applies to lint only; using it with export is a usage error.

SVG and PNG exports without `--all` read only the input. HTML and `--all` bundle every
file reachable through file links: HTML becomes one offline atlas whose other files
use addresses like `#/@file/health.d2/Sleep`, with cross-file breadcrumbs, Escape and
Back, and ZIPs keep the input's boards at their usual paths and put each other file's
boards under `@files/<path>/`, with file links rewritten to the target file's root
image. When nothing else is reached, the output is the same as before. A linked file
that does not compile is left out with a warning such as
`zoomflow: left out work/plan.d2, which links open: …`; links to it, or to files outside
`--root`, then show as missing in HTML and lose their target in ZIPs. The dangling-link
summary counts missing boards and files across every bundled file.
An export never replaces a file the diagram uses: a `.d2` output, or one that is a
source file or local image of the export, fails with exit **2**.

Lint uses the pinned bundled WASM compiler and needs no native D2 installation.
Exit status is **0** for success (including warnings), **1** for lint errors,
and **2** for invalid arguments, missing input/dependencies, compilation or export
failure. `--json` prints the core lint result; if there is no result (exit **2**),
it prints `{ "error": "<message>", "diagnostics": [] }` to stdout instead, with the
human-readable message still on stderr. `--boundary-ports` opts into explicit
port validation, and `--missing-backlink` opts into warnings for layers without a link back to their parent.
Lint always warns about classes that nothing defines (`undefined-class`) and about
Markdown labels with images, which are not rendered (`unsupported-label`).
Human diagnostics start with a clickable `path:line:column` when a source location is
known (one-based, relative to the working directory, possibly an imported file), or
with the path alone otherwise, as for connections and orphan boards. They name boards by their
trail, for example `Root > checkout`, followed by the shape or connection ID such
as `(a -> b)[0]`; `--json` keeps the raw board IDs and D2 ranges. Compile errors
print one `path:line:column: message` per line. Wrong arguments, including
conflicting lint/export options, an unsupported format or a non-`.d2` input, print
the short usage and point to `--help`.

Both commands snapshot the input and the `.d2` files it imports, transitively;
no other file or folder is read, so unrelated unreadable files cannot fail a run.
The project root defaults to the input file's directory regardless of the working
directory. Set `--root path` to include imports from parent folders; the input
must be inside it, by real path, so a symlinked root such as macOS `/tmp` also
accepts the input under `/private/tmp`, and an input spelled in another letter case, where
the disk allows it, is read as the disk spells it. Inputs, imports and local images must remain within that root,
compared by real path so a symlinked directory cannot reach outside it; symlinked
files are not followed. An import that exists but cannot be used names the reason
after D2's error, for example `(outside --root /work/app; pass --root to include
it)` or `(cannot read: permission denied)`. The bundled `zoomflow.d2` is available beside
each source file, with a local file of that name taking precedence; a local one that
is a symlink or a folder is reported like any other import, not replaced. Export stages the
same source snapshot in a temporary directory, then runs native D2 with ELK,
asset bundling and one explicit board target per process, running up to one
process per available CPU and skipping empty boards in HTML. D2's progress output
is dropped; its warnings and errors are printed once, with staging paths replaced
by your source paths. Local icon/image paths resolve
from the original input directory (Windows drive paths such as `C:\img.png` included),
must be regular files within the project root, and are staged alongside the sources,
so paths with spaces work too; remote images must be accessible during export. Only
`http:`, `https:` and `data:` images are URLs; any other scheme, a `//host`, a query or a
fragment is refused (`Local image must be a file path, not a URL`), since D2 would open it as a path.
D2 embeds the shipped fonts and bundled assets; HTML needs no compiler or network
at viewing time. Native D2 handles PNG rendering. No Go or Bun is needed for the CLI build.

`pnpm --filter cli test` builds the executable and runs real fixture subprocesses concurrently:
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

The [application workflow](../.github/workflows/application.yml) runs on pull requests
that change more than documentation. An `ubuntu-24.04` job typechecks, lints, verifies
vendored checksums, and runs the unit and CLI integration tests with the pinned native D2.
One job builds the production bundle, which the browser jobs download instead of
rebuilding. A pinned `macos-15` job, matching the screenshot baselines, runs the
`@visual` Chromium tests, the production smoke tests in Chromium and WebKit, and the
WebKit engine tests; every other browser test runs in Chromium, Firefox and WebKit on
four Linux shards per engine. Each browser job uploads its HTML report, with traces,
screenshots and diffs for failing tests; flaky passes are reported as warnings. Pushes to `main` run the [Pages deploy](../.github/workflows/pages.yml)
gate instead. See the [browser test guide](../tests/e2e/README.md) for what each job
covers and how to update baselines deliberately.

[Back to the quick start](../README.md)
