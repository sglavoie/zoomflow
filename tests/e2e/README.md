# Browser tests

Playwright starts the Vite app and runs every spec in Chromium, Firefox and WebKit.
Install browsers with `pnpm exec playwright install` and run `pnpm test:e2e` from the
workspace root. Do not run separate Playwright invocations concurrently: they share a
server and output directory.

Specs are grouped by feature. Add a test to the file for the feature it exercises;
shared helpers live in `helpers.ts` (source editor, preview readiness, project fixtures,
CodeMirror selection) and `menu.ts` (export menu and downloads).

## Editing

- `editor.spec.ts`: real CodeMirror input, retained previews and inline diagnostics on
  syntax errors, startup edits, exact source selections (including Unicode and container
  names), keyboard isolation, file replacement, D2 typing with indentation and folding,
  wrapped-line nesting columns, syntax colors in both themes, and formatting feedback
  that preserves selection and scroll.
- `diagnostics.spec.ts`: one diagnostics summary with a stable editor through failure and
  recovery, file-aware navigation to imported locations, and compiler failures without a
  usable location.
- `lint.spec.ts`: the bundled stdlib import, inline and list diagnostics, opt-in boundary
  checking (name mismatches and the zero-pairs guard), optional backlink warnings,
  dangling links, orphan layers, and recovery after lint and compiler errors.
- `shortcuts.spec.ts`: the shortcuts dialog and D2 comment toggling.
- `reference.spec.ts`: reference shortcuts, source and selection preservation, focus
  restoration, search, copy feedback, resizing, offline use, narrow and dark layouts, and
  tablet pane switching. `apps/web/test/reference.test.ts` compiles every bundled example.
- `flow-builder.spec.ts`: building flows from the form and editing them again.
- `ai.spec.ts`: AI edits and undo, availability checks and timeouts, cancellation,
  transport failures, highlights of changed lines, deletions on short phone screens, and
  the phone composer. Server unit tests verify that aborting a request ends its CLI process.

## Documents and projects

- `documents.spec.ts`: draft recovery and removal, same-name documents with separate
  histories, disk saves (slow, canceled and via shortcut), the download fallback, saved
  example identity, unsaved markers, stable header and status copy, preference storage,
  file drops, and undoable removal that restores handles, views and history.
- `examples.spec.ts`: the bundled examples, the grouped and filtered picker, and
  restoring examples with cancel and undo.
- `project.spec.ts`: opened folders with relative imports, project grouping and scoped
  removal with undo, per-project unsaved counts, and saving project file copies.
- `continuity.spec.ts`: concurrent-tab recovery, per-document and per-board view
  restoration, and restored selection and scroll when switching documents.
- `split-view.spec.ts`: both split layouts, independent panes and routes, one pane per
  draft, header commands following the active pane, and narrower fallbacks.
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
  and restarting a stalled preview without losing edits.
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
  defaults and remembered choices, progress, and cancellation when the source changes.
- `export-visual.spec.ts`: offline HTML at phone, short, landscape and enlarged-text sizes.

## Production build

`production.spec.ts` runs only in the `production` project, against `pnpm build` output
served by `vite preview`. It checks what only the bundle can break: the lazy D2 worker,
WASM, fonts and the offline export runtime. CI enables it; locally, build first and set
`ZOOMFLOW_PRODUCTION_E2E=1`:

```sh
pnpm build
ZOOMFLOW_PRODUCTION_E2E=1 pnpm exec playwright test --project=production
```

## Visual baselines

`visual.spec.ts` captures Chromium workspace baselines at 1440×900 and 390×844 (healthy,
source and preview errors, expanded tools, the reference, AI changes). `controls-visual.spec.ts`
captures export choices, the filtered picker, the confirmation dialog and breadcrumb
overflow. `export-visual.spec.ts` and `touch.spec.ts` add offline-viewer and touch
baselines. They fix locale, timezone, reduced motion and the AI availability response.

The application workflow runs on `macos-15`, matching the baseline family; browser
versions come from the pinned Playwright dependency. To review a layout change on macOS:

```sh
pnpm exec playwright test tests/e2e/visual.spec.ts --project=chromium --update-snapshots
pnpm exec playwright test tests/e2e/visual.spec.ts --project=chromium
```

Inspect changed PNGs before committing them. CI never updates baselines; failures upload
`playwright-report` and `test-results`. Other macOS versions render text slightly
differently, so some baselines fail locally on newer systems even without changes.
