import { shapeClass, type Board } from '@zoomflow/core';

/** Record ownership on D2's detached badges before merging layers or resizing link cues changes geometry. */
export function associateShapeBadges(root: Element, board: Board) {
  const icons = [...root.querySelectorAll('.appendix-icon:not([data-badge-shape])')].filter(icon => !icon.closest('a'));
  if (!icons.length) return;
  const models = new Map(board.diagram.shapes.map(shape => [shapeClass(shape.id), shape]));
  const seen = new Set<string>();
  const badges: { id: string; tooltip: boolean }[] = [];
  // D2 appends badges in the shapes' SVG draw order, tooltip before link. This also handles
  // oval, diamond and other outlines whose badge positions differ from their bounding boxes.
  for (const group of root.querySelectorAll('g')) {
    const shape = [...group.classList].map(name => models.get(name)).find(Boolean);
    if (!shape || seen.has(shape.id)) continue;
    seen.add(shape.id);
    if (shape.tooltip) badges.push({ id: shape.id, tooltip: true });
    if (shape.link) badges.push({ id: shape.id, tooltip: false });
  }
  // Only associate a complete renderer sequence; partially decorated SVGs retain their existing owners.
  if (icons.length !== badges.length || icons.some((icon, index) => Boolean(icon.querySelector('title')) !== badges[index].tooltip)) return;
  for (const [index, icon] of icons.entries()) icon.setAttribute('data-badge-shape', badges[index].id);
}
