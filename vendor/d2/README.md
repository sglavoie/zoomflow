# D2 WebKit compatibility build

Zoomflow pins `@d2lang/d2` to the checked-in package
`d2lang-d2-0.1.34-zoomflow.1.tgz`, built from D2 v0.9.0 at commit
[`d5a51743b6d5c00f1ec6f8340003f5d5a6ba4eda`](https://github.com/d2lang/d2/tree/d5a51743b6d5c00f1ec6f8340003f5d5a6ba4eda).
This is the source release behind npm 0.1.34, with one Goldmark compatibility
patch. No browser engine settings or server-side compiler are involved.

The published 0.1.34 and 0.1.33 packages overflow WebKit's native WASM stack during
Go initialization. Goldmark 1.8.5's two Linkify URL patterns use a character-class
repeat `{1,256}`. Go's regexp simplifier expands this to a deeply nested optional
chain. The failure occurs in `regexp/syntax.(*compiler).compile`, before D2's
API becomes available; the package loader then reports `d2.compile` undefined.

`goldmark-linkify.patch` replaces each bounded host repeat with
`(?:CLASS{16}){0,15}CLASS{1,16}`. The language and greedy length order remain
1 through 256, while the simplified regexp nesting drops below 32. No URL limit
is removed. The regression test compares original and patched match spans across
boundary lengths, URL suffixes and deterministic randomized strings, and checks
the compiled syntax depth. No D2 source or JavaScript API changes are needed.

## Rebuild

Install Go **1.27.1**, Bun **1.3.14**, Git and Python 3, then run:

```sh
python3 vendor/d2/build.py
# Or D2_BUILD_BUN=/absolute/path/to/bun python3 vendor/d2/build.py
(cd vendor/d2 && shasum -a 256 -c SHA256SUMS)
```

The script checks tool versions, fetches the exact commit, verifies Go modules,
vendors the pinned dependencies, applies the patch, runs its Go regression test,
and builds WASM plus the original browser/Node JavaScript wrappers. It copies the
matching Go runtime and creates a tarball with deterministic metadata. It uses
upstream Bun `build.js` directly and does not run the publishing workflow or
optional wasm-opt optimization. `provenance.json` records source and artifact
hashes. A normal `pnpm install` consumes the committed archive and needs none of
these build tools. Both core and web use the same package.

The original href/source-map assertions remain deliberate compatibility checks.
Run `node spike/d2-browser-repro.mjs` to compile in all three engines with both
the package loader and an explicit worker, then the focused viewer tests.

## Source and notices

D2's unmodified source is available at the commit URL above under MPL-2.0;
`LICENSE.txt` and `THIRD_PARTY_NOTICES.txt` are preserved. Goldmark's original
source is [v1.8.5](https://github.com/yuin/goldmark/tree/v1.8.5); its changed file
and patch are included in the package with `GOLDMARK_LICENSE.txt` (MIT).
`GO_LICENSE.txt` covers the bundled Go runtime (BSD-3-Clause). The package also
contains this provenance document and machine-readable hashes. To remove this
compatibility build after an upstream fix, replace both exact package pins and
rerun the compiler contract and three-browser startup/navigation checks.
