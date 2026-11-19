/** The bundled roles follow light/dark themes, including frozen image exports.
 * Attribute matching leaves custom project palettes and explicit colours untouched. */
export function libraryTheme(svg: string, interactive = false): string {
  if (!svg.includes('zf-filled')) return svg;
  if (svg.includes('id="zf-library-theme"')) return interactive ? litSurfaces(svg) : svg;
  const roles = [...svg.matchAll(/class="([^"]*\bzf-(?:step|decision|terminal|topic|branch|leaf)\b[^"]*)"/g)];
  if (roles.length && roles.every(match => match[1].split(/\s+/).includes('zf-shadow'))) {
    svg = svg.replace(/(<path\b[^>]*class="[^"]*\bconnection\b[^"]*"[^>]*style=")[^"]*(")/g, (tag) =>
      tag.replace(/stroke-width:1(?=;|")/, 'stroke-width:1.5;stroke-linecap:round'));
  }
  svg = svg.replace(/<\/svg>\s*$/, `<style id="zf-library-theme">
.zf-filled > .shape > [fill="#e9f0fa"] { fill: #edf2f8; }
.zf-decision.zf-filled > .shape > [fill="#e9f0fa"] { fill: #fff3db; }
.zf-terminal.zf-filled > .shape > [fill="#e9f0fa"] { fill: #e3f3eb; }
.zf-topic.zf-filled > .shape > [fill="#e9f0fa"] { fill: #eee9f8; }
.zf-filled > text[fill="#203044"], .zf-filled > .shape > text[fill="#203044"] { fill: #203044; }
@media screen and (prefers-color-scheme:dark) {
  .zf-filled > .shape > [fill="#e9f0fa"] { fill: #26364c; }
  .zf-decision.zf-filled > .shape > [fill="#e9f0fa"] { fill: #443721; }
  .zf-terminal.zf-filled > .shape > [fill="#e9f0fa"] { fill: #203d36; }
  .zf-topic.zf-filled > .shape > [fill="#e9f0fa"] { fill: #342d49; }
  .zf-filled > text[fill="#203044"], .zf-filled > .shape > text[fill="#203044"] { fill: #e4eaf2; }
}
</style></svg>`);
  return interactive ? litSurfaces(svg) : svg;
}

/** Viewer-only paint travels with board snapshots and offline HTML. Image exports retain the flat palette. */
function litSurfaces(svg: string): string {
  if (!svg.includes('zf-filled') || svg.includes('id="zf-library-surfaces"')) return svg;
  const neutralEdges = /\.stroke-B1\s*\{\s*stroke:\s*#8eaed7\s*;?\s*\}/i.test(svg) ? `
  .connection.stroke-B1, marker .stroke-B1 { stroke: #a1bbde; }
  marker .fill-B1 { fill: #a1bbde; }` : '';
  const canvas = /\.fill-N7\s*\{\s*fill:\s*#121c2a\s*;?\s*\}/i.test(svg) ? 'svg.d2-svg > rect.fill-N7 { fill: #0e111d; }' : '';
  const gradients = [
    ['step', '#2c374b', '#252e3f'],
    ['decision', '#483c2c', '#3c3225'],
    ['terminal', '#294238', '#22382f'],
    ['topic', '#3b344d', '#312b41'],
  ].map(([role, top, bottom]) => `<linearGradient id="zf-lit-${role}" x1="0" y1="0" x2="0" y2="1"><stop stop-color="${top}"/><stop offset="1" stop-color="${bottom}"/></linearGradient>`).join('');
  return svg.replace(/<\/svg>\s*$/, `<defs>${gradients}</defs><style id="zf-library-surfaces">
@media screen and (prefers-color-scheme:dark) {
  .zf-filled > .shape > [fill="#e9f0fa"] { fill: url(#zf-lit-step); }
  .zf-decision.zf-filled > .shape > [fill="#e9f0fa"] { fill: url(#zf-lit-decision); }
  .zf-terminal.zf-filled > .shape > [fill="#e9f0fa"] { fill: url(#zf-lit-terminal); }
  .zf-topic.zf-filled > .shape > [fill="#e9f0fa"] { fill: url(#zf-lit-topic); }
${canvas}
  /* Match only the stdlib's neutral connector palette, including its arrowheads. */
${neutralEdges}
}
</style></svg>`);
}
