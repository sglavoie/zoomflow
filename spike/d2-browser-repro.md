# D2 0.1.34 WebKit startup blocker

Run `node spike/d2-browser-repro.mjs` from the repository root. An optional browser
argument selects `chromium`, `firefox`, or `webkit`. The script serves installed
package files verbatim from a temporary local HTTP server, runs the browsers and
closes all resources. It does not use Vite or the viewer.

Observed 2026-10-18 with Playwright 1.64.1 on macOS arm64:

| Browser | Default package blob worker | Explicit worker with original wasm_exec.js and d2.wasm |
| --- | --- | --- |
| Chromium 156.0.8078.4 | `a -> b` compiles, 2 shapes | 2 shapes |
| Firefox 157.0 | 2 shapes | 2 shapes |
| WebKit 27.2 | `d2.compile` is undefined after startup error | `RangeError: Maximum call stack size exceeded` |

The explicit-worker rejection stack repeatedly contains
`5129@wasm-function[5129]`. This happens during `go.run(instance)`, before any D2
source is compiled. The default loader reports a secondary error because its
worker signals readiness even though the Go runtime did not publish `self.d2`.

The same failure was observed in headed WebKit, cached webkit-2359, and the
production Vite build served by `vite preview`. The current Playwright WebKit
build is webkit-2370. This rules out the viewer, Vite development transforms, and
the default blob-worker loader as the sole cause; the precise upstream WASM or
engine defect remains undetermined.

The package declares an `@d2lang/d2/worker` export but the installed
`dist/browser/` contains only `index.js`; `worker.js` is absent. The explicit-worker
probe uses the original Go runtime and WASM shipped under `dist/node-cjs/` and
adds only initialization and compile messaging. No package files are patched.

Keep the D2 version pin and all three browser projects intact. Resolving this
blocker may require an upstream-compatible runtime fix or an explicitly approved
dependency change. Do not substitute mocked or server-side compilation to make
the viewer checks pass.
