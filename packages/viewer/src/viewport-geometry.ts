export type Box = { x: number; y: number; width: number; height: number };

/** Keep a view inside the fitted diagram; a view wider or taller than it stays within its overhang. */
export function clampBox(base: Box, next: Box): Box {
  const xLimit = base.x + base.width - next.width;
  const yLimit = base.y + base.height - next.height;
  const x = Math.max(Math.min(base.x, xLimit), Math.min(Math.max(base.x, xLimit), next.x));
  const y = Math.max(Math.min(base.y, yLimit), Math.min(Math.max(base.y, yLimit), next.y));
  return { ...next, x, y };
}

/** Frame `target` with minimal movement from `box`, keeping the current zoom whenever it fits.
 * `available` is the visible user-space size at the current zoom, letterboxing included. */
export function revealBox(base: Box, box: Box, target: Box, available: { width: number; height: number },
  minZoom: number): Box {
  const factor = Math.max(1, target.width / available.width, target.height / available.height);
  const width = Math.min(base.width / minZoom, box.width * factor);
  const height = width * base.height / base.width;
  const centerX = Math.max(target.x + target.width - available.width * factor / 2,
    Math.min(target.x + available.width * factor / 2, box.x + box.width / 2));
  const centerY = Math.max(target.y + target.height - available.height * factor / 2,
    Math.min(target.y + available.height * factor / 2, box.y + box.height / 2));
  return { x: centerX - width / 2, y: centerY - height / 2, width, height };
}
