import type { createViewport } from './viewport';
import type { Box } from './viewport-geometry';

/** An isolated whole-board picture; pan and zoom update only its view rectangle.
 * Self-contained so the exported HTML can serialize the same implementation. */
export function setupMinimap(stage: HTMLElement, viewport: Pick<ReturnType<typeof createViewport>, 'mapView' | 'panTo'>) {
  const map = document.createElement('div');
  map.className = 'zf-minimap';
  map.setAttribute('aria-hidden', 'true');
  const picture = document.createElement('img');
  picture.alt = '';
  picture.draggable = false;
  const rectangle = document.createElement('div');
  rectangle.className = 'zf-minimap-view';
  map.append(picture, rectangle);
  const teardown = new AbortController();
  const signal = teardown.signal;
  let pointer: number | undefined;
  let board: Box | undefined;

  function update() {
    const view = viewport.mapView();
    const suppressed = stage.clientWidth < 600 || Boolean(stage.dataset.layerRoot) ||
      stage.hasAttribute('data-transition') || Boolean(stage.closest('[data-presentation]'));
    map.hidden = suppressed || !view || !board;
    if (!view || !board) return;
    const { visible } = view;
    // Ignore subpixel rounding at the fitted view, including its letterboxing.
    const epsilon = 0.5 * visible.width / Math.max(1, stage.clientWidth);
    const clipped = visible.x > board.x + epsilon || visible.y > board.y + epsilon ||
      visible.x + visible.width < board.x + board.width - epsilon ||
      visible.y + visible.height < board.y + board.height - epsilon;
    map.toggleAttribute('data-visible', clipped);
    const left = Math.max(board.x, Math.min(board.x + board.width, visible.x));
    const top = Math.max(board.y, Math.min(board.y + board.height, visible.y));
    const right = Math.max(left, Math.min(board.x + board.width, visible.x + visible.width));
    const bottom = Math.max(top, Math.min(board.y + board.height, visible.y + visible.height));
    rectangle.style.left = `${100 * (left - board.x) / board.width}%`;
    rectangle.style.top = `${100 * (top - board.y) / board.height}%`;
    rectangle.style.width = `${100 * (right - left) / board.width}%`;
    rectangle.style.height = `${100 * (bottom - top) / board.height}%`;
  }
  function render() {
    const svg = stage.querySelector<SVGSVGElement>(':scope > svg');
    const view = viewport.mapView();
    // Keep the picture's coordinate frame too: refitting on resize can round its
    // measured bounds slightly differently, but must not shift the rectangle on it.
    board = view?.board;
    if (svg && board && !stage.dataset.layerRoot) {
      const { x, y, width, height } = board;
      const copy = svg.cloneNode(true) as SVGSVGElement;
      // Offline boards share fonts and theme rules in the document head; images
      // cannot inherit them, so include them in this board's cached picture.
      const shared = document.getElementById('zoomflow-svg-style');
      if (shared) {
        const style = document.createElementNS('http://www.w3.org/2000/svg', 'style');
        style.textContent = shared.textContent;
        copy.prepend(style);
      }
      copy.setAttribute('viewBox', `${x} ${y} ${width} ${height}`);
      copy.setAttribute('width', String(width));
      copy.setAttribute('height', String(height));
      copy.removeAttribute('style');
      copy.querySelectorAll('.zf-selection, .zf-depth-stack, .appendix-icon').forEach(node => node.remove());
      // The viewer's transparent canvas rules live outside the SVG.
      copy.querySelectorAll<SVGElement>(':scope > rect, :scope > svg > rect').forEach(node => { node.style.opacity = '0'; });
      picture.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(new XMLSerializer().serializeToString(copy))}`;
      const scale = Math.min(180 / width, 120 / height);
      map.style.width = `${width * scale}px`;
      map.style.height = `${height * scale}px`;
    } else picture.removeAttribute('src');
    // Board replacement removes stage children. Reuse this control and its listeners.
    stage.append(map);
    update();
  }
  function pan(event: PointerEvent) {
    if (!board) return;
    const bounds = map.getBoundingClientRect();
    viewport.panTo(board.x + (event.clientX - bounds.left - map.clientLeft) / map.clientWidth * board.width,
      board.y + (event.clientY - bounds.top - map.clientTop) / map.clientHeight * board.height);
  }
  map.addEventListener('pointerdown', event => {
    if (event.button !== 0 || pointer !== undefined) return;
    event.preventDefault();
    event.stopPropagation();
    pointer = event.pointerId;
    map.setPointerCapture(pointer);
    pan(event);
  }, { signal });
  map.addEventListener('pointermove', event => { if (event.pointerId === pointer) pan(event); }, { signal });
  function finish(event: PointerEvent) {
    if (event.pointerId !== pointer) return;
    if (map.hasPointerCapture(pointer)) map.releasePointerCapture(pointer);
    pointer = undefined;
  }
  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture'] as const) map.addEventListener(type, finish, { signal });
  map.addEventListener('click', event => { event.preventDefault(); event.stopPropagation(); }, { signal });
  stage.addEventListener('zf-boardchange', render, { signal });
  stage.addEventListener('zf-viewportchange', update, { capture: true, signal });
  const state = new MutationObserver(update);
  state.observe(stage, { attributes: true, attributeFilter: ['data-transition', 'data-layer-root'] });
  if (stage.parentElement) state.observe(stage.parentElement, { attributes: true, attributeFilter: ['data-presentation'] });
  const resize = new ResizeObserver(update);
  resize.observe(stage);
  stage.addEventListener('zf-destroy', () => {
    teardown.abort(); state.disconnect(); resize.disconnect(); map.remove(); picture.removeAttribute('src');
  }, { once: true, signal });
  render();
}
