# Browser tests

Playwright starts the Vite app and runs viewer navigation and animation tests in
Chromium, Firefox and WebKit. Install browsers with `pnpm exec playwright install`
and run `pnpm test:e2e` from the workspace root.

The geometry tests pause the actual zoom animation at time zero and measure the
rendered overlay on the next animation frame. They compare all four box dimensions
with the clicked SVG anchor, within 2 px, at two viewport sizes and D2 pad 0/100.
The `?pad=` app parameter controls D2's rendering padding for these checks.

`export.spec.ts` downloads real SVG, PNG, ZIP and HTML files. It opens HTML via
`file://` with the browser offline, exercises nested and cyclic board navigation,
and checks remote-image embedding and fallback. Root PNG baselines are per browser
and OS; review the images before deliberately updating them with
`pnpm exec playwright test tests/e2e/export.spec.ts --update-snapshots`.

`editor.spec.ts` exercises real CodeMirror input, retained previews and inline
diagnostics on syntax errors, recovery, startup edits, exact source selections
(including Unicode and container names), selection-driven board navigation,
preview highlights, editor keyboard isolation and file replacement.

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
