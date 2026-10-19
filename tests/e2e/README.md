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
(including Unicode and container names), selection-driven board navigation,
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
