# Wow pass review

The `feat/wow-pass` branch develops the interface in eleven sessions. It adds no
dependencies, changes no D2 storage semantics, and is left unpushed for review.

| Session | Commits | Result |
| --- | --- | --- |
| 1 | `d518e56` | Zoom through linked shapes with staggered fades and interruptible motion. |
| 2 | `b87bbaa`, `c33e3ec` | Larger first fit, matching starter previews and a canvas dot grid; keep edge add handles clear of selected shapes. |
| 3 | `3d11e4f`, `f1c1142` | Brand and control icons, grouped shape actions and phone spacing; isolate reference reload tests from module caching. |
| 4 | `2188e61`, `0e3b0ad` | Use linking labels consistently for board names; update remaining exact-name assertions. |
| 5 | `de1eb71`, `61bd1eb`, `5c350c6` | Clearer coaching, rename fields and link cues; collapse crowded detail counts and stabilize starter alignment checks. |
| 6 | `f566cd6` | Readable walkthrough paths, name-first cards and centered presentation framing. |
| 7 | `574fa02`, `0440554` | Lazy example pictures with foreground work taking priority; isolate the atlas race probe from thumbnail workers. |
| 8 | `fdb4abe` | Searchable command palette with existing actions, boards and examples. |
| 9 | `c529aff` | A minimap for clipped boards, with matching offline behavior and stable snapshot coordinates. |
| 10 | `1d1d04a` | Single-file share links that preserve board routes and open independent drafts. |
| 11 | `5a3fc93`, `fec8d64`, `c6c2890`, `f6cb5ab`, `e958b50`, `f2d0191`, `d20dbd0` | Final visual review, offline snapshot fonts and colors, unclipped phone Style menu, selection actions clear of the minimap, refreshed screenshot and guides; browser-test setup repairs, bounded local validation and a native macOS WebKit workaround. |

The first session 11 follow-up, `fec8d64`, moves the existing workspace visual
platform guard ahead of browser context creation. Supported Chromium comparisons
and their baselines remain unchanged.

The next follow-up, `c6c2890`,
uses CodeMirror's select-all command to set up the short-phone AI deletion test,
then verifies its exact starting source. WebKit's DOM-based fill had intermittently
left a leading blank line, correctly producing an additional deletion highlight.
Matching native crash reports also traced the context-setup failures to macOS
Screen Time observer teardown. That commit attempted a launch-preference workaround,
but a later probe proved the flag ineffective. The current workaround is the native
shim in [tests/e2e/webkit-macos.m](../tests/e2e/webkit-macos.m), introduced by
`d20dbd0` below; see the [test guide](../tests/e2e/README.md).

The follow-up `f6cb5ab` (`test(e2e): stabilize diagram search source setup`) applies the same
select-all setup to diagram search's shared starter helper. Its exact-source
assertion caught another leading blank line from WebKit fill on a phone viewport,
before any search interaction. The source assertion and all search checks remain
unchanged.

The follow-up `e958b50` adds `pnpm test:e2e:production` to select only the Chromium
and WebKit bundle smoke projects, avoiding a duplicate full matrix in local
validation. Full production regression remains available through `pnpm test:e2e:built`
and in CI. It caps local workers at four and clarifies the CI worker-override comment
while preserving CI concurrency, browser coverage, assertions and retries.

The follow-up `f2d0191` stabilizes the comment-shortcut test by waiting for preview
readiness, replacing the complete editor document through keyboard input and checking
its exact source before the existing comment and undo assertions. It also records
validation timings without presenting the earlier failed matrix as a passing run.

The follow-up `d20dbd0` replaces the ineffective `webkit-macos.sh` wrapper with the
native shim above and the `webkit-macos.ts` launcher. On macOS 27, both WebKit projects
use the same bundled browser with a process-local library that disables Screen Time
before each `WKWebView` initialization and verifies the setting. Other platforms keep
the stock launcher; persistent OS settings and shared browser files are unchanged.
The commit also adds a bounded lifecycle check covering 205 headless and headed
contexts, including verification that the native feature is disabled.

The final review walks a fresh workspace in light and dark at 1440×900 and
390×844: rename, add, drill and return, Boards, Find, Style, Walkthrough, Present,
command palette, zoom/minimap, example picker, Export, HTML preview and a share
link opened in a fresh browser context. Downloaded HTML is also opened from disk
with networking disabled to review zoom, grid, board names, walkthrough and minimap.
The minimap deliberately stays hidden on phone-width stages.

Focused regression coverage lives in `delight.spec.ts`, `transition.spec.ts` and
`viewer.spec.ts`. The complete acceptance commands, including the production
browser run, are documented in [Development](development.md) and the
[README](../README.md#check-a-change); the ASL runner records their authoritative
results separately from this implementation review.

## Wow pass 2

The `feat/wow-pass-2` branch refines the existing workspace in eight sessions,
without runtime dependencies, new storage semantics or a layout redesign.

| Session | Commits | Result |
| --- | --- | --- |
| 1 | `3a5c5fd`, `29cac47` | Linked shapes grow into their detail boards; return mirrors the motion, live and offline. |
| 2 | `d92d83a`, `2e4062e` | Vendored Geist and Geist Mono throughout the UI, diagrams and exports; readable phone fits. |
| 3 | `af71f4d`, `0eab1f8`, `6aa2319`, `1687d53` | Consistent stdlib examples, with font-ready fits that preserve edited views. |
| 4 | `e5bf0f6` | Warmer dark surfaces, lit interactive shapes and verified contrast; static images retain their flat palette. |
| 5 | `118d695`, `e7bc02b`, `444bba4` | Fresh diagrams arrive, a quiet arrow invites the first drill, and coaching waits for the reader. |
| 6 | `02a1846`, `14660c8`, `9bba845`, `cd9c9fc` | Idle example-picture warming, described Create actions, stable search clicks and keyboard focus. |
| 7 | `cb1e75c`, `32560d3`, `647d638` | Added/deleted shape motion, lifted branch drags, and coherent save/cancellation test probes. |
| 8 | This commit | A 500 ms followed-edge pulse in Walkthrough/Present and offline HTML, slow editor edge flow, static framed-image regression coverage and the final visual review; hide stale editor selection rings during walkthroughs. |

The final review uses fresh light and dark workspaces at 1440×900 and 390×844.
It exercises drill and return, rename, add, delete, branch dragging, the example
picker and Create menu, Walkthrough, Present, and downloaded HTML opened offline.
The refreshed [workspace screenshot](images/workspace.png) shows the current
canvas-first start. Motion remains interruptible and respects reduced motion.
Image tests compare framed SVG and PNG downloads with their static counterparts
while editor flow or a paused, visible pulse is active. The SVG must contain no
pulse/flow markup or animation rules; both files must retain identical contents.

The ASL runner owns the full lint, typecheck, unit, browser, build and production
browser gates. Focused implementation checks and visual-review evidence are
recorded in the session 8 handoff; authoritative results remain with the runner.
