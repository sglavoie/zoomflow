# Fonts

Zoomflow ships **Geist** Regular, Bold, Italic and SemiBold for the UI and D2
labels, and **Geist Mono** Regular for source and monospace UI. All five are
unmodified TTFs (internal version **1.900**) under the
[SIL Open Font License 1.1](LICENSE.txt), copyright 2026 The Geist Project Authors.
The monospace UI uses regular weight, so no extra Mono face is needed.

Source: the official [vercel/geist-font v1.9.2 release](https://github.com/vercel/geist-font/releases/tag/v1.9.2),
commit `ef2597cfc42f4797676df105517ccc0a1cfa6569`.
Extract `Geist/ttf/Geist-{Regular,Bold,Italic,SemiBold}.ttf` and
`GeistMono/ttf/GeistMono-Regular.ttf` from
[`geist-font-v1.9.2.zip`](https://github.com/vercel/geist-font/releases/download/v1.9.2/geist-font-v1.9.2.zip).
The license is [OFL.txt at that commit](https://github.com/vercel/geist-font/blob/ef2597cfc42f4797676df105517ccc0a1cfa6569/OFL.txt).
Verify the exact shipped bytes with `cd fonts && shasum -a 256 -c SHA256SUMS`.

Vite bundles these assets locally. CSS faces use `font-display: swap`. The app
loads the four diagram faces once and supplies `fontRegular`, `fontBold`,
`fontItalic` and `fontSemibold` to d2.js **compile**: the pinned API registers
the family there, measures with it, and carries it into **render**. Supplying
fonts only to render has no effect. The worker's JSON transport requires base64
strings despite its declared `Uint8Array` type; `apps/web/src/fonts.ts` retains
that compatibility conversion and retry behavior. Builder previews and browser
exports use the same compiler resources.

The CLI resolves these files relative to its module and supplies
`--font-regular`, `--font-bold`, `--font-italic` and `--font-semibold` for every
native render, including SVG/PNG ZIPs and HTML. Release archives carry the font
license, provenance and checksums; CLI archives also carry all five TTFs.
Explicit D2 monospace/code, sketch and fallback glyph fonts still come from the
pinned D2 distribution; its browser API has no custom monospace option.

D2 embeds subsets in SVGs. Interactive HTML shares those subsets between boards
and its shell: one additional compile includes diagram labels, board metadata,
title/subtitle, printable ASCII and viewer symbols. Regular and bold subsets
also cover headings, controls and search; each data URL is emitted only once.
Single-board HTML gets the same shell coverage. Presentation image headings and connected-canvas captions
embed their own small text subsets. No export fetches a font or needs
Geist installed. D2 subsets omit kerning tables; image headings measure individual glyph advances.
Glyphs Geist does not contain (such as emoji and the Command symbol) retain the
platform fallback, as in the compiler. Board snapshots copy the shared `zoomflow-svg-style` rules.

## Static starter images

To regenerate `apps/web/src/order-preview{,-dark}.svg`, start `pnpm dev`, open
the untouched Order flow, and download the current-board SVG once in each theme
with the Presentation frame off. Use the browser compiler and bundled fonts,
including the bundled `zoomflow.d2` import. For the dark loading asset, apply
`libraryTheme(svg, true)` from `packages/viewer/src/library-theme.ts` to the
downloaded SVG and freeze its added dark query with `@media all`. This keeps the
loading preview aligned with viewer lighting while image downloads stay flat.
The image export has 24 units of
padding; reduce each side by 8 to match this short board's live 16-unit fit.
Add 8 to the nested SVG viewBox's x/y and subtract 16 from its width/height;
set both SVGs' dimensions to that width/height and the outer viewBox to
`0 0 width height`. Set the starter background's maximum width in `style.css`
to `width * 1.5`; the coarse-pointer minimum is `width * 11.01 / 16` for
these 16-unit labels. It matches the viewer spending spare padding to keep the
whole flow readable on phones. Recheck light/dark on desktop, phone and touch
phone against the live fit.
