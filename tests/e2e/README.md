# Browser tests

Playwright starts the Vite app and runs viewer navigation and animation tests in
Chromium, Firefox and WebKit. Install browsers with `pnpm exec playwright install`
and run `pnpm test:e2e` from the workspace root.

`transition.spec.ts` checks that board changes fade in place at two viewport
sizes, without scaling or an overlay. It also checks reduced motion support.

`export.spec.ts` downloads real SVG, PNG, ZIP and HTML files. It opens HTML via
`file://` with the browser offline, exercises nested and cyclic board navigation,
and checks remote-image embedding and fallback. Root PNG baselines are per browser
and OS; review the images before deliberately updating them with
`pnpm exec playwright test tests/e2e/export.spec.ts --update-snapshots`.

`editor.spec.ts` exercises real CodeMirror input, retained previews and inline
diagnostics on syntax errors, recovery, startup edits, exact source selections
(including Unicode and container names), explicit source reveal,
preview highlights, editor keyboard isolation and file replacement.

`polish.spec.ts` checks draft recovery and removal, copy downloads, syntax
highlighting, mobile editor visibility, and Space+drag panning on linked shapes.

`refinement.spec.ts` covers isolated undo histories for same-name documents, restored
selection and scroll, draft grouping and example restoration, stable header geometry,
remembered preferences, unobscured mobile controls, delayed progress feedback, error
navigation, and distinct link cues in both live and offline viewers. `ai.spec.ts` also
covers availability checks, cancellation, elapsed time, and the explicit undo action;
the server unit tests verify that aborting a request terminates its CLI process.

`workspace-polish.spec.ts` covers tablet pane switching and reference focus restoration,
D2 comment toggling, the save shortcut and download fallback, stable editor geometry
through compile errors, project grouping and scoped removal, independent appearance
controls, and desktop canvas controls outside the diagram.

`reference.spec.ts` checks reference shortcuts from the editor and reference,
source/selection preservation, focus restoration, search and scroll retention,
pointer and keyboard resizing, stored split size, offline search and clipboard
handling, board navigation isolation, and narrow-screen/dark-mode layouts with
storage disabled. `apps/web/test/reference.test.ts` compiles and renders each
bundled example with the pinned D2 compiler and checks Zoomflow lint.

`lint.spec.ts` checks the bundled stdlib import, inline and list diagnostics,
opt-in boundary checking (name mismatches and the zero-pairs guard), optional backlink warnings, dangling
links, orphan layers, and recovery after both lint and compiler errors.
`viewer.spec.ts` also checks port-free nested navigation, ancestor-link suggestions,
and inferred parent connections in the live viewer and offline HTML.

`continuity.spec.ts` verifies concurrent-tab recovery (including project imports),
per-document and per-board view restoration, mobile error repair, compact stable
source chrome, zoom hints, and explicit export scope. Draft-store unit tests cover
revision conflicts, migration, deletion, and edits to recovered copies.

`visual.spec.ts` captures 24 Chromium workspace baselines at 1440×900 and 390×844:
light/dark healthy views, source errors, mobile preview errors, expanded AI/lint
panels, the reference panel, and expanded settings at short, landscape, and enlarged-text phone sizes. It fixes locale, timezone, reduced motion, and the
local AI availability response; it uses the real editor and D2 renderer.

The application workflow runs all checks on `macos-15`, matching the macOS baseline
family. Browser versions come from the pinned Playwright dependency. To review a
layout change, run on macOS:

```sh
pnpm exec playwright test tests/e2e/visual.spec.ts --project=chromium --update-snapshots
pnpm exec playwright test tests/e2e/visual.spec.ts --project=chromium
```

Inspect changed PNGs before committing them. CI never updates baselines; failures
upload `playwright-report` and `test-results` for inspection. Changes to the runner
OS or Playwright version may require reviewed baseline updates. Do not run separate
Playwright invocations concurrently: they share a server and output directory.

`finishing.spec.ts` covers source-pane continuity across project files, keyboard
shape selection and focus after recompilation, file-aware diagnostic navigation
and unavailable locations, normalized wheel units, expanded-tool scrolling,
larger text, and module/worker/font startup recovery. Chromium also exercises
real multi-touch events through CDP. Software-keyboard layout is simulated with
short viewports and a `visualViewport` resize; it is not a physical-device keyboard test.

`final-polish.spec.ts` covers passive source selection versus explicit reveal, quiet
status copy, saved-example identity and undo, and directional link badges in live and
offline viewers. `preview-queue.spec.ts` holds a real compilation to verify that
intermediate edits are skipped; queue unit tests cover invalidation and failure recovery.
`export-visual.spec.ts` checks offline HTML at phone, short, landscape, and enlarged-text
sizes in all three browsers, with eight light/dark Chromium visual baselines. It verifies
that the diagram remains usable and its controls stay inside the viewport.

`interaction-polish.spec.ts` checks minimal viewport framing on explicit reveal,
spatial keyboard navigation and Tab exit on a large diagram, per-project unsaved
indicators across undo/save/reload, actual D2 typing and folding, recovery from a
stalled worker, and touch cues plus keyboard behavior in offline HTML. Language
unit tests compile representative multiline labels and nested boards with the
bundled D2 engine, alongside indentation and fold-range assertions.

`viewport-polish.spec.ts` adds a touch-device visual baseline, checks that enlarged
link hit areas do not overlap, and verifies reveal while the mobile preview is hidden.
