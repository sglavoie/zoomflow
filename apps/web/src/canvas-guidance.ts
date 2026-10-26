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
  canSelectSource: () => boolean, editSource: () => void, canvasKeys: (target: Element) => string | undefined = () => undefined) {
  let input: 'keyboard' | 'touch' | 'mouse' = matchMedia('(pointer: coarse)').matches ? 'touch' : 'mouse';
  let hovered: Element | null = null;
  function update() {
    const focused = stage.contains(document.activeElement) ? document.activeElement : null;
    const target = input === 'keyboard' ? focused : hovered?.isConnected ? hovered : null;
    const link = target?.closest('a[data-link-kind]');
    const shape = target?.closest('[data-shape-id]');
    const source = canSelectSource();
    const activate = input === 'touch' ? 'Tap' : 'Click';
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
      text = `${activate} to select · Double-click to rename · The arrow badge will ${action[0].toLowerCase()}${action.slice(1)}`;
    } else if (link) {
      const action = link.getAttribute('aria-label') ?? 'Open link';
      text = `${activate} to ${action[0].toLowerCase()}${action.slice(1)}${source && input === 'mouse' ? ' · Alt+click selects source' : ''}`;
    } else if (shape && source) {
      text = `${activate} to select this shape’s source`;
    } else {
      const child = stage.querySelector('a[data-link-direction="child"]');
      const label = child?.querySelector('text')?.textContent?.trim();
      text = label ? child!.getAttribute('data-follow') === 'badge' ? `${activate} the arrow on ${label} to explore` : `${activate} ${label} to explore`
        : source ? `${activate} a shape to select its source`
        : 'Use the breadcrumbs to explore this diagram';
      if (input === 'touch') text += ' · Pinch to zoom';
    }
    if (!stage.querySelector('svg')) text = '';
    setGuidance(text, input === 'keyboard' && Boolean(focused));
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
  stage.addEventListener('zf-boardchange', () => {
    hovered = null;
    if (!stage.querySelector('svg')) {
      const help = document.createElement('div');
      help.className = 'empty-board-help';
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
      stage.replaceChildren(help);
    }
    update();
  });
  new MutationObserver(update).observe(stage.parentElement!.parentElement!, {
    attributes: true, subtree: true, attributeFilter: ['aria-busy', 'data-preview-state'],
  });
  stage.parentElement!.classList.add('workspace-canvas');
}
