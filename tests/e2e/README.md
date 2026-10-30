# Browser tests

Playwright starts the Vite app and runs the behavioral specs in Chromium, Firefox and
WebKit. `production.spec.ts` runs only in its own project (see below), and screenshot
comparisons run in Chromium on macOS only: `visual.spec.ts` and `controls-visual.spec.ts`
skip elsewhere, while `export.spec.ts`, `export-visual.spec.ts` and `touch.spec.ts` run
their behavioral checks in every engine but compare baselines only in Chromium on macOS
(see [Visual baselines](#visual-baselines)). Every test that compares a baseline carries
the `@visual` tag, which decides where CI runs it. Install browsers with
`pnpm exec playwright install` and run `pnpm test:e2e` from the workspace root.

The dev server listens on port 4173 and the production preview on 4174. To run separate
Playwright invocations at the same time, give each its own base port (the preview uses
the next one) and its own output directory:

```sh
ZOOMFLOW_E2E_PORT=4600 pnpm exec playwright test tests/e2e/editor.spec.ts --output=test-results/editor
```

Specs are grouped by feature. Add a test to the file for the feature it exercises;
shared helpers live in `helpers.ts` (source editor, preview readiness, project fixtures,
CodeMirror access through `withEditorView`, selection) and `menu.ts` (export menu and downloads).

## Editing

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
- `continuity.spec.ts`: concurrent-tab recovery, per-document and per-board view
  restoration, and restored selection and scroll when switching documents.
- `split-view.spec.ts`: both split layouts, independent panes and routes, one pane per
  draft, header commands following the active pane, narrower fallbacks, one main landmark
  with distinctly labelled editors, per-pane divider sizes, and releasing the hidden
  second pane's page-level key listeners until the split reopens.
- `source-split.spec.ts`: the adaptive diagram/source split and remembered resizes.

## Diagram

- `viewer.spec.ts`: drill-down navigation, ancestor-link suggestions and inferred parent
  connections, live and offline.
- `canvas.spec.ts`: zoom, pan and fit, wheel and pinch input, spatial keyboard navigation,
  link badges (direction, tooltips, size through zoom), compact breadcrumbs, canvas
  guidance, explicit source reveal, and shape selection by keyboard and Alt+click.
- `transition.spec.ts`: board changes fade in place, with reduced-motion support.
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

- `export.spec.ts`: real SVG, PNG, ZIP and HTML downloads, HTML opened over `file://`
  offline with nested and cyclic navigation, remote-image embedding and fallback, export
  defaults and remembered choices, progress, cancellation when the source changes, and an
  export button that stays disabled until the running export finishes.
- `export-visual.spec.ts`: offline HTML at phone, short, landscape and enlarged-text sizes.

## Production build

Production mode serves `pnpm build` output through `vite preview`. CI always uses it;
locally, build first and set `ZOOMFLOW_PRODUCTION_E2E=1`. The behavioral projects then
load the bundle instead of the dev server's modules, which starts each page about a third
faster. Tests that import or rewrite source modules (`/@fs/…`, `/src/compiler.ts`) pin
`devURL` from `servers.ts`, which both modes keep running. Intercept the D2 module through
`d2Module` from `helpers.ts`, which matches it in both modes.

`production.spec.ts` runs only in the `production` project. It checks what only the
bundle can break: the lazy D2 worker, WASM, fonts and the offline export runtime:

```sh
pnpm build
ZOOMFLOW_PRODUCTION_E2E=1 pnpm exec playwright test --project=production
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
