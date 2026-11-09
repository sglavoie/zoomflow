/** The bundled roles follow light/dark themes, including frozen image exports.
 * Attribute matching leaves custom project palettes and explicit colours untouched. */
export function libraryTheme(svg: string): string {
  if (!svg.includes('zf-filled') || svg.includes('id="zf-library-theme"')) return svg;
  const roles = [...svg.matchAll(/class="([^"]*\bzf-(?:step|decision|terminal|topic|branch|leaf)\b[^"]*)"/g)];
  if (roles.length && roles.every(match => match[1].split(/\s+/).includes('zf-shadow'))) {
    svg = svg.replace(/(<path\b[^>]*class="[^"]*\bconnection\b[^"]*"[^>]*style=")[^"]*(")/g, (tag) =>
      tag.replace(/stroke-width:1(?=;|")/, 'stroke-width:1.5;stroke-linecap:round'));
  }
  return svg.replace(/<\/svg>\s*$/, `<style id="zf-library-theme">
.zf-filled > .shape > [fill="#e9f0fa"] { fill: #edf2f8; }
.zf-decision.zf-filled > .shape > [fill="#e9f0fa"] { fill: #fff3db; }
.zf-terminal.zf-filled > .shape > [fill="#e9f0fa"] { fill: #e3f3eb; }
.zf-topic.zf-filled > .shape > [fill="#e9f0fa"] { fill: #eee9f8; }
.zf-filled > text[fill="#203044"] { fill: #203044; }
@media screen and (prefers-color-scheme:dark) {
  .zf-filled > .shape > [fill="#e9f0fa"] { fill: #26364c; }
  .zf-decision.zf-filled > .shape > [fill="#e9f0fa"] { fill: #443721; }
  .zf-terminal.zf-filled > .shape > [fill="#e9f0fa"] { fill: #203d36; }
  .zf-topic.zf-filled > .shape > [fill="#e9f0fa"] { fill: #342d49; }
  .zf-filled > text[fill="#203044"] { fill: #e4eaf2; }
}
</style></svg>`);
}
