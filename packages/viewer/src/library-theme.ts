/** The bundled filled look follows the SVG's theme, including frozen image exports.
 * Attribute matching leaves project palettes and explicit shape colours untouched. */
export function libraryTheme(svg: string): string {
  if (!svg.includes('zf-filled') || svg.includes('id="zf-library-theme"')) return svg;
  return svg.replace(/<\/svg>\s*$/, `<style id="zf-library-theme">
.zf-filled > .shape > [fill="#e9f0fa"] { fill: #e9f0fa; }
.zf-filled > text[fill="#203044"] { fill: #203044; }
@media screen and (prefers-color-scheme:dark) {
  .zf-filled > .shape > [fill="#e9f0fa"] { fill: #26364c; }
  .zf-filled > text[fill="#203044"] { fill: #e4eaf2; }
}
</style></svg>`);
}
