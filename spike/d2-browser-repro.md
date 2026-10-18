# D2 WebKit startup reproducer and fix

Run `node spike/d2-browser-repro.mjs` from the repository root. An optional browser
argument selects `chromium`, `firefox`, or `webkit`. The script serves installed
package files verbatim from a temporary HTTP server and closes all resources.
It does not use Vite or the viewer, and exits nonzero if a compile fails.

The current exact `0.1.34-zoomflow.1` compatibility package succeeds in both modes
on Chromium 156.0.8078.4, Firefox 157.0 and WebKit 27.2. See
[the pinned build, source patch and notices](../vendor/d2/README.md).

## Original failure, isolated 2026-10-18

| Upstream 0.1.34 / browser | Default blob worker | Explicit worker with original Go runtime and WASM |
| --- | --- | --- |
| Chromium 156.0.8078.4 | `a -> b` compiles, 2 shapes | 2 shapes |
| Firefox 157.0 | 2 shapes | 2 shapes |
| WebKit 27.2 | `d2.compile` undefined after startup error | `RangeError: Maximum call stack size exceeded` |

The upstream explicit-worker stack repeats `5129@wasm-function[5129]` during
`go.run(instance)`, before any D2 source is compiled. A debug build resolves this
to `regexp/syntax.(*compiler).compile`. Temporary regexp instrumentation identified
Goldmark's URL host pattern `{1,256}` as the failing initializer. Factoring the
bounded repeat preserves its matching semantics and avoids deep recursion.

The upstream package also failed in headed WebKit, cached webkit-2359, and the
production Vite build. Upstream 0.1.33 fails similarly and lacks `dispose()`.
Changing the browser flags or removing a browser project was not necessary.

The package declares `@d2lang/d2/worker` but `dist/browser/worker.js` is absent.
The explicit probe therefore initializes a worker with the unmodified Go runtime
and WASM files from the package's Node distribution. The default mode exercises
the actual bundled browser loader used by the app.

## Comparing another build

The following environment variables allow isolated probes without changing the
application dependency. Paths must be absolute:

- `D2_REPRO_NODE_DIR`: alternate extracted package's `dist/node-esm` directory;
  its sibling `dist/browser/index.js` supplies the package mode.
- `D2_REPRO_MODE`: `package` or `explicit` (defaults to both).
- `D2_REPRO_WASM`: alternative WASM file for explicit mode.
- `D2_REPRO_WASM_EXEC`: matching Go `wasm_exec.js` for explicit mode.

For example, extract an upstream package tarball outside the repository and set
`D2_REPRO_NODE_DIR` to compare it. No probe modifies installed dependencies or
Playwright browser binaries.
