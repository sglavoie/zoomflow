import { D2 } from '@d2lang/d2';
import { indexBoards } from '@zoomflow/core';
import { Window } from 'happy-dom';
import { expect, it } from 'vitest';
import { associateShapeBadges } from '../../../packages/viewer/src/shape-badges';

it('associates actual D2 badges for every shape outline, draw order, containers and repeated labels', async () => {
  const engine = new D2();
  const window = new Window();
  try {
    const types = ['rectangle', 'circle', 'oval', 'diamond', 'hexagon', 'cloud', 'cylinder', 'queue', 'page', 'person', 'parallelogram'];
    const source = types.map((type, index) => `shape_${index}: Same label {
  shape: ${type}
  link: https://example.com/same
  tooltip: Hint ${index}
  z-index: ${types.length - index}
}`).join('\n') + `
Plain: Same label
Tooltip: Same label {tooltip: Tooltip only}
Link: Same label {link: https://example.com/same}
Container: {
  link: https://example.com/same
  tooltip: Container tooltip
  Child: Same label {shape: oval; link: https://example.com/same; tooltip: Child tooltip}
}
layers: {
  Detail: {shape_0: Same label {shape: circle; link: https://example.com/same; tooltip: Nested tooltip}}
}`;
    const compiled = await engine.compile(source, { layout: 'elk' });
    for (const board of indexBoards(compiled.diagram).values()) {
      const svg = await engine.render(compiled.diagram, { ...compiled.renderOptions, target: board.target, noXMLTag: true });
      // happy-dom's XML parser stops at D2's CDATA styles; geometry and DOM order need no styles here.
      const markup = svg.replace(/<style\b[\s\S]*?<\/style>/g, '');
      const root = new window.DOMParser().parseFromString(markup, 'image/svg+xml').documentElement as unknown as Element;
      associateShapeBadges(root, board);
      const icons = [...root.querySelectorAll('.appendix-icon')];
      expect(icons.every(icon => icon.hasAttribute('data-badge-shape'))).toBe(true);
      for (const shape of board.diagram.shapes) {
        const badges = icons.filter(icon => icon.getAttribute('data-badge-shape') === shape.id);
        expect(badges, `${board.id}: ${shape.type} ${shape.id}`).toHaveLength(Number(Boolean(shape.tooltip)) + Number(Boolean(shape.link)));
        if (shape.tooltip) expect(badges.find(icon => icon.querySelector('title'))?.querySelector('title')?.textContent).toBe(shape.tooltip);
      }
    }
  } finally { await engine.dispose(); await window.happyDOM.close(); }
});
