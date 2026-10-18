# Fonts

Zoomflow ships Source Sans Pro Regular, Bold, Italic and Semibold under the
[SIL Open Font License 1.1](LICENSE.txt). Copyright 2010–2018 Adobe; the reserved
font name is “Source”. These are unmodified font files.

The files come from [D2 v0.9.0's font directory](https://github.com/d2lang/d2/tree/d5a51743b6d5c00f1ec6f8340003f5d5a6ba4eda/d2renderers/d2fonts/ttf),
at commit `d5a51743b6d5c00f1ec6f8340003f5d5a6ba4eda`, matching our pinned compiler's
defaults. Regular, Bold and Semibold are version 2.045; Italic is version 1.095.
The license comes from [Adobe's corresponding release](https://github.com/adobe-fonts/source-sans/blob/ce77773581f4d454f0fa985c073bb25c721bfcf5/LICENSE.txt).
`SHA256SUMS` records the exact shipped bytes.

Vite bundles these assets locally. The app loads them once and supplies
`fontRegular`, `fontBold`, `fontItalic` and `fontSemibold` to d2.js **compile**:
the pinned API registers the family there, measures with it, and carries it in
the compiled diagram into **render**. Supplying fonts only to render has no
effect. The worker's JSON transport requires base64 strings despite its declared
`Uint8Array` type; `apps/web/src/fonts.ts` contains that compatibility conversion.
The shared render callback covers the viewer and every browser export.

The CLI resolves the same files relative to its module and supplies
`--font-regular`, `--font-bold`, `--font-italic` and `--font-semibold` for every
native render, including SVG/PNG ZIPs and HTML. D2 embeds the used font subsets
in SVGs, so exports need no installed font or external font request.
Explicit D2 monospace/code, sketch and fallback glyph fonts still come from the
pinned D2 distribution; the browser API has no custom monospace font options.
