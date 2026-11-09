import { setupCanvasCoach } from './canvas-coach';
/** Listen to the page only while the viewer is shown: a hidden pane (closed split view) stops until it resumes. */
export function pageListeners(stage: HTMLElement, listen: (signal: AbortSignal) => void) {
  let listening: AbortController | undefined;
  const start = () => {
    listening?.abort();
    listening = new AbortController();
    listen(listening.signal);
  };
  start();
  stage.addEventListener('zf-resume', start);
  for (const type of ['zf-suspend', 'zf-destroy']) stage.addEventListener(type, () => listening?.abort());
}

/** Workspace guidance follows the current task; offline viewers keep navigation-only hints. `canvasKeys` names the
 * keys that edit a step or topic on the diagram. */
export function setupCanvasGuidance(stage: HTMLElement, setGuidance: (text: string, priority?: boolean) => void,
  canSelectSource: () => boolean, editSource: () => void, canvasKeys: (target: Element) => string | undefined = () => undefined,
  empty?: { available(): boolean; start(kind: 'flow' | 'mind map', focus: HTMLElement): void }) {
  let input: 'keyboard' | 'touch' | 'mouse' = matchMedia('(pointer: coarse)').matches ? 'touch' : 'mouse';
  let hovered: Element | null = null;
  const nearby = document.createElement('div');
  nearby.className = 'canvas-context-help'; nearby.hidden = true;
  nearby.setAttribute('aria-hidden', 'true'); stage.after(nearby);
  function placeGuidance() {
    const selected = stage.querySelector<SVGGraphicsElement>('.zf-canvas-selected');
    const hide = !selected || Boolean(stage.dataset.walkthrough || stage.dataset.transition) ||
      Boolean(stage.parentElement?.querySelector('.canvas-rename:not([hidden]), .canvas-coach:not([hidden])'));
    if (nearby.hidden !== hide) nearby.hidden = hide;
    if (nearby.hidden || !selected) return;
    const editable = canvasKeys(selected)?.includes('F2 renames');
    nearby.textContent = editable ? input === 'keyboard' ? canvasKeys(selected)!.split(' · ').slice(0, 2).join(' · ') : input === 'touch' ? 'More → Rename · + adds a step' : 'Double-click to rename · + to keep building'
      : 'More actions are beside this shape';
    const box = selected.getBoundingClientRect();
    const canvas = stage.getBoundingClientRect();
    const area = nearby.offsetParent?.getBoundingClientRect() ?? canvas;
    if (box.top < canvas.top + nearby.offsetHeight + 16 || box.bottom > canvas.bottom || box.right < canvas.left || box.left > canvas.right) { nearby.hidden = true; return; }
    nearby.style.left = `${Math.max(canvas.left + 8, Math.min(box.left + box.width / 2 - nearby.offsetWidth / 2, canvas.right - nearby.offsetWidth - 8)) - area.left}px`;
    nearby.style.top = `${box.top - nearby.offsetHeight - 14 - area.top}px`;
  }
  function update() {
    if (stage.dataset.board && !stage.querySelector('svg')) renderEmpty();
    const focused = stage.contains(document.activeElement) ? document.activeElement : null;
    const target = input === 'keyboard' ? focused : hovered?.isConnected ? hovered : null;
    const link = target?.closest('a[data-link-kind]');
    const shape = target?.closest('[data-shape-id]');
    const connection = target?.closest('[data-flow-connection]');
    const source = canSelectSource();
    const activate = input === 'touch' ? 'Tap' : 'Click';
    const rename = input === 'touch' ? 'More → Rename' : 'Double-click to rename';
    let text: string;
    if (input === 'keyboard' && focused) {
      // Steps and topics edit on the diagram, where Enter may add a topic instead of selecting source.
      const keys = canvasKeys(focused);
      text = link ? `Enter: ${link.getAttribute('aria-label')}${keys ? ` · ${keys}` : source ? ' · Alt+Enter selects source' : ''}`
        : keys ? `${keys} · Tab leaves the diagram`
        : shape && source ? 'Enter selects source · Arrow keys move between shapes'
        : 'Arrow keys move between shapes · Tab leaves the diagram';
    } else if (link && link.getAttribute('data-follow') === 'badge' && !target?.closest('.appendix-icon')) {
      // Steps and topics open their board from the arrow badge; the shape itself is for editing.
      const action = link.getAttribute('aria-label') ?? 'Open link';
      text = `${activate} to select · ${rename} · The arrow badge will ${action[0].toLowerCase()}${action.slice(1)}`;
    } else if (link) {
      const action = link.getAttribute('aria-label') ?? 'Open link';
      text = `${activate} to ${action[0].toLowerCase()}${action.slice(1)}${source && input === 'mouse' ? ' · Alt+click selects source' : ''}`;
    } else if (connection) {
      text = `${activate} to edit this connection’s label or delete it`;
    } else if (shape && source) {
      text = canvasKeys(shape)?.includes('F2 renames') ? `${activate} to select · ${rename}` : `${activate} to select this shape’s source`;
    } else {
      const child = stage.querySelector('a[data-link-direction="child"]');
      const label = child?.querySelector('text')?.textContent?.trim();
      text = label ? child!.getAttribute('data-follow') === 'badge' ? `${activate} the arrow on ${label} to explore` : `${activate} ${label} to explore`
        : [...stage.querySelectorAll('[data-shape-id]')].some(shape => canvasKeys(shape)?.includes('F2 renames'))
          ? `${activate} a step to add to it · ${rename}`
        : source ? `${activate} a shape to select its source`
        : 'Use the breadcrumbs to explore this diagram';
      if (input === 'touch') text += ' · Pinch to zoom';
    }
    if (input !== 'keyboard' && shape?.classList.contains('zf-branch-draggable')) {
      text += input === 'touch' ? ' · Hold, then drag onto a new parent to move this branch' : ' · Drag onto a new parent to move this branch';
    }
    if (!stage.querySelector('svg')) text = '';
    setGuidance(text, input === 'keyboard' && Boolean(focused));
    placeGuidance();
  }
  stage.addEventListener('pointerover', (event) => {
    input = event.pointerType === 'touch' ? 'touch' : 'mouse';
    hovered = event.target instanceof Element ? event.target : null;
    update();
  });
  stage.addEventListener('pointerleave', () => { hovered = null; update(); });
  pageListeners(stage, signal => {
    window.addEventListener('pointerdown', (event) => { input = event.pointerType === 'touch' ? 'touch' : 'mouse'; update(); }, { signal });
    window.addEventListener('keydown', (event) => {
      if (['Tab', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
        input = 'keyboard'; update();
      }
    }, { capture: true, signal });
  });
  stage.addEventListener('focusin', update);
  stage.addEventListener('focusout', () => queueMicrotask(update));
  stage.addEventListener('zf-sourcechange', update);
  stage.addEventListener('zf-previewstate', update);
  function renderEmpty() {
    if (!stage.querySelector('svg')) {
      const editable = Boolean(empty?.available());
      if (stage.querySelector('.empty-board-help')?.getAttribute('data-editable') === String(editable)) return;
      const help = document.createElement('div');
      help.className = 'empty-board-help';
      help.dataset.editable = String(editable);
      const title = document.createElement('p');
      title.textContent = 'This board is empty.';
      const example = document.createElement('p');
      example.append('Add a connection in Source, for example ');
      const code = document.createElement('code');
      code.textContent = 'a -> b';
      example.append(code, '.');
      const edit = document.createElement('button');
      edit.type = 'button';
      edit.textContent = 'Edit source';
      edit.addEventListener('click', editSource);
      help.append(title, example, edit);
      if (editable && empty) {
        title.textContent = 'What happens first?';
        example.textContent = 'Start with a step or a central idea. Build the rest right here.';
        for (const kind of ['flow', 'mind map'] as const) {
          const button = document.createElement('button');
          button.type = 'button';
          button.textContent = kind === 'flow' ? 'Add first step' : 'Start mind map';
          button.addEventListener('click', () => empty.start(kind, button));
          help.insertBefore(button, edit);
        }
      }
      stage.replaceChildren(help);
    }
  }
  stage.addEventListener('zf-boardchange', () => {
    hovered = null;
    renderEmpty();
    update();
  });
  const observer = new MutationObserver(update);
  observer.observe(stage.parentElement!.parentElement!, {
    attributes: true, subtree: true, attributeFilter: ['aria-busy', 'data-preview-state', 'class'],
  });
  stage.addEventListener('zf-viewportchange', placeGuidance, { capture: true });
  stage.addEventListener('zf-destroy', () => { observer.disconnect(); nearby.remove(); });
  stage.parentElement!.classList.add('workspace-canvas');
  setupCanvasCoach(stage, canvasKeys);
}
