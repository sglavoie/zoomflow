# Browser tests

Playwright starts the Vite app and runs the behavioral specs in Chromium, Firefox and
WebKit. `production.spec.ts` runs only in its production projects (see below), and screenshot
comparisons run in Chromium on macOS only: `visual.spec.ts` and `controls-visual.spec.ts`
skip elsewhere, while `export.spec.ts`, `export-visual.spec.ts` and `touch.spec.ts` run
their behavioral checks in every engine but compare baselines only in Chromium on macOS
(see [Visual baselines](#visual-baselines)). Every test that compares a baseline carries
the `@visual` tag, which decides where CI runs it. Install browsers with
`pnpm exec playwright install` and run `pnpm test:e2e` from the workspace root.

The workspace-only visual spec checks platform support with a worker-fixture skip
before creating pages or contexts. Unsupported engines still report skipped cases,
without browser setup for tests that cannot compare those baselines.

On macOS 27 (Darwin 27), both WebKit projects use a test-only native workaround
for `SIGABRT` in `STScreenTimeConfigurationObserver dealloc`, called by
`WKWebView _uninstallScreenTimeWebpageController` during window teardown.
Three native reports on 2026-11-16 (00:44, 02:18 and 12:36) showed this stack;
Playwright can subsequently report “Cannot find parent object browser … to create
debugger” before the app loads.

The previous `-WebKitDebugScreenTimeEnabled false` argument was **ineffective**:
a probe against the bundled framework read the argument as false while the actual
feature remained enabled. WebKit's
[Cocoa preference loader](https://github.com/WebKit/WebKit/blob/main/Source/WebKit/UIProcess/Cocoa/WebPreferencesCocoa.mm)
only applies such arguments to preferences marked `defaultsOverridable`, and
[ScreenTimeEnabled](https://github.com/WebKit/WebKit/blob/main/Source/WTF/Scripts/Preferences/UnifiedWebPreferences.yaml)
is not one of them.

`webkit-macos.ts` compiles `webkit-macos.m` with Xcode Command Line Tools once per
source/architecture/OS version into ignored `dist/webkit-macos/`. It launches the
same Playwright app and bundled frameworks directly, loading the small library
only for our test process. Before each `WKWebView` initialization, the library uses
WebKit's private feature API to disable `ScreenTimeEnabled` and reads it back;
it exits with an error if the feature API changes or disabling fails. This prevents
the Screen Time observer from being installed. It changes no macOS defaults or
shared browser files. Other macOS versions and Linux use Playwright's normal launch.
Headless and headed launches retain Playwright's normal arguments. This is a
workaround for the native integration, not a fix to Apple's Screen Time framework;
remove it when an updated WebKit/macOS combination resolves the crash.

Run the bounded regression check after changing this code or upgrading WebKit:

```sh
node tests/e2e/webkit-macos-check.mjs
```

It creates and closes 200 contexts across four headless browsers, then five headed
contexts. Every page must render and respond to a click, all browsers must exit
cleanly, and captured native diagnostics must confirm the preference is disabled
at all 205 view initializations. It has a three-minute limit and saves diagnostics
to `dist/webkit-macos/lifecycle-check.log`; it needs no app server or full suite.
On 2026-11-16, this check passed in 19.3 seconds, followed by 35 WebKit
canvas-connection cases (five repetitions, 49.7 seconds) and both production smoke
cases (6.2 seconds), all without retries. The native check verifies the setting
itself, since successful stress runs alone did not expose the ineffective flag.

The dev server listens on port 4173 and the production preview on 4174. To run separate
Playwright invocations at the same time, give each its own base port (the preview uses
the next one) and its own output directory:

```sh
ZOOMFLOW_E2E_PORT=4600 pnpm exec playwright test tests/e2e/editor.spec.ts --output=test-results/editor
```

Specs are grouped by feature. Add a test to the file for the feature it exercises;
shared helpers live in `helpers.ts` (source editor, preview readiness, project fixtures,
CodeMirror access through `withEditorView`, selection) and `menu.ts` (export menu and downloads).

Local runs use at most four workers; CI retains its job-specific concurrency.
Override with `--workers=2` on a constrained host. Avoid multiplying workers by
the machine's full CPU count when other browser or simulator jobs share it.
On 2026-11-16, the same 36 diagram-search and theme cases across all three engines
passed with zero retries in 95.2 seconds with two workers and 52.0 seconds with four
(45% less wall time). This is a subset measurement, not a full-suite time guarantee.
The subsequent runner-owned matrix finished in 37.1 minutes, and the selected
production smoke gate passed in 10.2 seconds, versus 58.6 minutes plus a one-hour
timeout for the preceding duplicated workflow. That faster matrix was **not a
passing acceptance run**: 1,543 cases passed, 72 were skipped, and two failed
(Firefox editor setup and native WebKit context creation). The editor setup was
then repaired and passed five repetitions in each engine. The native WebKit
workaround above replaces the ineffective flag; full acceptance still requires
a subsequent passing matrix. Timing evidence
must not be treated as evidence that the complete suite passed.
To repeat the comparison, run these sequentially, without other Zoomflow tests:

```sh
pnpm test:e2e tests/e2e/diagram-search.spec.ts tests/e2e/theme.spec.ts --workers=2
pnpm test:e2e tests/e2e/diagram-search.spec.ts tests/e2e/theme.spec.ts --workers=4
```

For an exact source replacement in a short CodeMirror viewport, focus the editor,
press `ControlOrMeta+a`, then use `page.keyboard.insertText`. WebKit's DOM-based
`fill()` can leave a leading blank line there. Check `editorText(page)` before
testing a precise diff; rendered text assertions can normalize that whitespace.

`layers.spec.ts` covers the connected layer view, individual and subtree visibility,
editing shapes whose IDs repeat across boards, undo, visible-layer SVG/PNG exports,
and phone controls. `packages/viewer/test/layers.test.ts` covers layout, fragment-ID
isolation, per-document choices, and failed or superseded layer renders.

## Editing

- `command-palette.spec.ts`: canvas/editor opening, filtering and ranking, existing
  control dispatch, boards and examples, availability, IME/modal isolation, focus
  return, split-pane targeting, and light/dark desktop/phone layouts.

- `canvas-board-transfers.spec.ts`: the three flow/mind-map transfers from the
  reported connected canvas, attached-root moves, cross-board parent pickers,
  occupied targets, cycle rejection, save/reopen, export-visibility remapping,
  layer-depth reveal, undo/redo, phone controls and real touch dragging.
- `canvas-graph-branches.spec.ts`: upstream moves in builder flows and custom D2,
  retained outgoing arrows and attached boards, merges and styling, keyboard parent
  selection, cycle rejection, undo/redo, save/reopen, connected boards with repeated
  IDs, stale pickers, phone controls, and real touch dragging.
- `canvas-branches.spec.ts`: dragging mind map subtrees, keyboard and diagram parent
  selection, duplicate labels, generated detail boards, attached boards, undo/redo
  with selection, invalid drops, Escape, stale sources, phone controls, and held-touch
  dragging alongside ordinary touch panning.
- `canvas-connections.spec.ts`: creating Yes/No branches, keyboard and pointer target
  selection, parallel arrows and loops, labels and deletion, undo/redo, save/reopen,
  cancellation and stale-source guards, nested connected boards, phone controls, and
  exports without editing overlays.
- `editor.spec.ts`: real CodeMirror input, retained previews and inline diagnostics on
  syntax errors, startup edits, exact source selections (including Unicode and container
  names), keyboard isolation, file replacement, D2 typing with indentation and folding,
  wrapped-line nesting columns, syntax colors in both themes, and formatting feedback
  that preserves selection and scroll.
- `diagnostics.spec.ts`: one diagnostics summary with a stable editor through failure and
  recovery, file-aware navigation to imported locations, compiler failures without a
  usable location, and live regions that are not rewritten with unchanged text.
- `lint.spec.ts`: the bundled stdlib import, inline and list diagnostics, opt-in boundary
  checking (name mismatches and the zero-pairs guard), optional backlink warnings,
  dangling links, orphan layers, and recovery after lint and compiler errors.
- `shortcuts.spec.ts`: the shortcuts dialog and D2 comment toggling.
- `reference.spec.ts`: reference shortcuts, source and selection preservation, focus
  restoration, search, copy feedback, resizing, offline use, narrow and dark layouts, and
  tablet pane switching. `apps/web/test/reference.test.ts` compiles and renders every
  reference snippet, and `apps/web/test/examples.test.ts` covers the bundled examples.
  Reference reload checks bypass HTTP caching and wait for preview initialization,
  isolating saved search and divider state from Firefox/Vite cached-module failures.
  Browser storage still survives the real page reload.
- `flow-builder.spec.ts`: building flows from the form and editing them again, and focus
  that moves to the neighbouring connection after a removal.
- `mind-map-builder.spec.ts`: mind maps from an outline, drilling into a detail board,
  reopening the outline, indenting from the keyboard and buttons, and phone layout.
  `apps/web/test/mind-map-model.test.ts` compiles generated maps and checks lossless reopening.
- `board-builders.spec.ts`: adding flow and mind map boards to shapes from the selection bar,
  context menu and keyboard, editing each board with its own builder, and the explanation
  when an edit would strand an attached board. `apps/web/test/board-model.test.ts` covers
  locating board blocks, attached sections and reattaching boards to moved topics.
- `canvas-edit.spec.ts`: renaming, adding and removing steps and topics on the diagram with
  the keyboard, undo and redo on the diagram, selecting the shape that led down after going
  up, the boards outline, the source following the board on view, and link previews.
  `apps/web/test/canvas-model.test.ts` covers the edits on flows, mind maps and detail boards.
- `diagram-search.spec.ts`: finding nested boards and shapes by label, board ancestry,
  framing and selection, keyboard controls, literal labels, preview updates and errors,
  document switches, imported shapes, and narrow screens. Core search tests cover
  indexing layers, scenarios and steps with board-scoped shape IDs.
- `project-search.spec.ts`: searching unvisited and unlinked project files, file paths
  and board breadcrumbs, cross-file Back/Forward and Escape navigation, broken-file
  reporting, unsaved imports changed in another pane, activating a result already
  open there, and narrow dark layouts. Unit tests cover incremental indexing,
  cache invalidation, cancellation, coalescing, failed-file retry and engine failures.
- `project-search-indexing.spec.ts`: indexing progress with a held compiler request,
  stopping queued work on close, cached results and keyboard focus during incremental
  updates, and retry after an engine interruption.
- `project-check.spec.ts`: fresh cross-file board checks across unvisited and unlinked
  files, unsaved edits, compiler and imported-source navigation, preservation of file
  contents, invalidation from another pane, active-project scope, and narrow dark layouts.
- `project-check-progress.spec.ts`: progress, cancellation and closing with a held
  compiler request, discarding stale output, checking again, engine interruptions,
  and opening files for errors without source locations. Unit tests use the real D2
  compiler to check snapshot consistency, lint options and compile-order independence.
- `ai.spec.ts`: AI edits and undo, availability checks and timeouts, cancellation,
  transport failures, highlights of changed lines, deletions on short phone screens, the
  phone composer, sending with ⌘/Ctrl+Enter, and AI settings mirrored across split panes
  with one availability check per change. Server unit tests verify that aborting a request ends its CLI process.

## Documents and projects

- `documents.spec.ts`: draft recovery and removal, same-name documents with separate
  histories, disk saves (slow, canceled and via shortcut), the download fallback, saved
  example identity, unsaved markers, stable header and status copy, preference storage,
  file drops, undoable removal that restores handles, views and history, back/forward
  cache recovery, saving when the page is hidden, and reusing unchanged drafts when a
  file, folder, picked file handle or empty draft is opened again.
- `examples.spec.ts`: the bundled examples, the grouped and filtered picker, and
  restoring examples with cancel and undo.
- `project.spec.ts`: opened folders with relative imports, project grouping and scoped
  removal with undo, per-project unsaved counts, and saving project file copies.
- `project-save.spec.ts`: sequential saving across both panes, reopening saved disk
  contents, overwrite cancellation, write failures, missing files and permissions,
  cancellation during a write, later edits staying dirty, and source ZIP fallback.
- `project-archive.spec.ts`: fresh-browser round trips of editable source, export
  visibility and layer depth, relative imports and links, unlinked source errors,
  unvisited file settings, entry-file restoration, independent copies and invalid
  archives. Core tests cover archive validation and expansion limits; picker tests
  cover snapshotting both panes and ignoring damaged view metadata.
- `continuity.spec.ts`: concurrent-tab recovery, per-document and per-board view
  restoration, and restored selection and scroll when switching documents.
- `curation.spec.ts`: visibility and layer settings surviving reloads, unedited
  examples retaining settings without dirtying source, cross-pane atlas exports and
  saved choices for unvisited files, document-wide visibility reset, deleted shapes,
  and restoring examples with undo. Viewer unit tests cover damaged metadata,
  custom layer selections, independent copies and export snapshots; draft tests cover
  metadata-only concurrent recovery and unavailable browser storage.
- `split-view.spec.ts`: both split layouts, independent panes and routes, one pane per
  draft, header commands following the active pane, narrower fallbacks, one main landmark
  with distinctly labelled editors, per-pane divider sizes, and releasing the hidden
  second pane's page-level key listeners until the split reopens.
- `source-split.spec.ts`: the adaptive diagram/source split and remembered resizes.

## Diagram

- `viewer.spec.ts`: drill-down navigation, ancestor-link suggestions and inferred parent
  connections, live and offline; minimap clipping geometry, click/drag panning,
  visibility, cleanup, selection-bar clearance and exclusion from SVG/PNG downloads.
- `canvas.spec.ts`: zoom, pan and fit, wheel and pinch input, spatial keyboard navigation,
  link badges (direction, tooltips, size through zoom), compact breadcrumbs, canvas
  guidance, explicit source reveal, and shape selection by keyboard and Alt+click.
- `transition.spec.ts`: linked-shape zooms in and out with staggered fades, live
  and offline, plus input cancellation, reduced-motion support, and isolated offline
  snapshot/minimap label fonts and colors.
- `fullscreen.spec.ts`: the fullscreen diagram.
- `engine.spec.ts`: slow first download, module and worker startup failures with retry,
  restarting a stalled preview without losing edits, and an engine notice that stays with
  the pane that owns it while the other pane edits.
- `preview-queue.spec.ts`: intermediate edits are skipped while a compile is running.

## Phones and touch

- `mobile.spec.ts`: the Preview/Source switch, selection that reveals source, first fit,
  compact and scrollable tools, the on-screen keyboard (simulated with a `visualViewport`
  resize), and unobscured canvas controls.
- `touch.spec.ts`: touch cues and hit areas, reveal from the hidden preview, and a touch
  visual baseline. Chromium also exercises real multi-touch input through CDP in `canvas.spec.ts`.

## Export

- `share-link.spec.ts`: copied source and board in a fresh context, fresh unsaved
  identities with existing draft records unchanged, Unicode, malformed/truncated
  links, folder and URL length limits, clipboard failures, and light/dark Export panels.
- `export.spec.ts`: real SVG, PNG, ZIP and HTML downloads, PNG clipboard copies,
  HTML opened over `file://`
  offline with nested and cyclic navigation, remote-image embedding and fallback, export
  defaults and remembered choices, progress, cancellation when the source changes, and an
  export button that stays disabled until the running export finishes.
- `export-visual.spec.ts`: offline HTML at phone, short, landscape and enlarged-text sizes.
- `export-search.spec.ts`: offline search of exported diagrams and atlases, duplicate
  labels across files, nested boards, scenarios and steps, framing and focus, browser
  history, literal labels, modal keyboard controls, and narrow dark layouts.

## Production build

Use one full browser matrix per validation pass. The routine local sequence is
`pnpm test:e2e`, `pnpm build`, then `pnpm test:e2e:production`. The last command
selects only the Chromium and WebKit bundle smoke tests. Setting
`ZOOMFLOW_PRODUCTION_E2E=1` alone does **not** select those projects: it runs the
whole matrix again against the bundle and then adds the two smoke tests.

For a full production regression pass instead, run `pnpm build` followed by
`pnpm test:e2e:built`. CI retains full production coverage across all three engines.
Use a focused spec while repairing a failure, for example
`pnpm test:e2e tests/e2e/diagram-search.spec.ts --project=webkit`; run the full
matrix after the repair is stable. Neither command changes assertions or retries.

Production mode serves `pnpm build` output through `vite preview`. CI always uses it;
locally, build first and set `ZOOMFLOW_PRODUCTION_E2E=1`. The behavioral projects then
load the bundle instead of the dev server's modules, which starts each page about a third
faster. Tests that import or rewrite source modules (`/@fs/…`, `/src/compiler.ts`) pin
`devURL` from `servers.ts`, which both modes keep running. Intercept the D2 module through
`d2Module` from `helpers.ts`, which matches it in both modes.

`production.spec.ts` runs in the `production` (Chromium) and `production-webkit` projects. It checks what only the
bundle can break: the lazy D2 worker, WASM, fonts and the offline export runtime:

```sh
pnpm build
pnpm test:e2e:production
```

## Visual baselines

`visual.spec.ts` captures Chromium workspace baselines at 1440×900 and 390×844 (healthy,
source and preview errors, expanded tools, the reference, AI changes). `controls-visual.spec.ts`
captures export choices, the filtered picker, the confirmation dialog and breadcrumb
overflow. `export-visual.spec.ts` and `touch.spec.ts` add offline-viewer and touch
baselines, and `export.spec.ts` compares the downloaded root PNG. They fix locale,
timezone, reduced motion and the AI availability response. `playwright.config.ts`
allows 0.5% differing pixels for every `toHaveScreenshot` call, and the PNG download
uses the same tolerance.

The application workflow runs the `@visual` Chromium tests, the production projects and
`engine.spec.ts` in WebKit on `macos-15`, matching the baseline family; browser versions
come from the pinned Playwright dependency. Every other test runs in Chromium, Firefox and
WebKit on sharded `ubuntu-24.04` jobs, where `comparesVisuals` skips every comparison, so
a new test that compares a baseline needs the tag (`{ tag: '@visual' }`) or it never
compares in CI. To review a layout change on macOS 15:

```sh
pnpm exec playwright test tests/e2e/visual.spec.ts --project=chromium --update-snapshots
pnpm exec playwright test tests/e2e/visual.spec.ts --project=chromium
```

Inspect changed PNGs before committing them. Other macOS versions render text slightly
differently, so some baselines fail locally on newer systems even without changes; use
`ZOOMFLOW_SKIP_VISUAL=1` there.

Without a macOS 15 machine, run the "Application checks" workflow manually (Actions, Run
workflow) with `update_snapshots` checked. It regenerates the Chromium baselines of the
`@visual` tests, skips the regular browser tests and uploads only the
new or changed PNGs as the `visual-baselines` artifact, laid out by repository path.
Extract it at the repository root, inspect every image and commit the ones you accept.

CI never updates baselines on its own. In CI a failed test is retried once. A test that
passes only on retry does not fail the run; `flaky-reporter.ts` reports it as a warning
on its file and in the job summary. Every browser run uploads `playwright-report` and
`test-results`, so flaky and failed runs both leave traces to inspect.
