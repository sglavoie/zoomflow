/** Workspace guidance follows the current task; offline viewers keep navigation-only hints. */
export function setupCanvasGuidance(stage: HTMLElement, setGuidance: (text: string, priority?: boolean) => void,
  canSelectSource: () => boolean, editSource: () => void) {
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
      text = link ? `Enter: ${link.getAttribute('aria-label')}${source ? ' · Alt+Enter selects source' : ''}`
        : shape && source ? 'Enter selects source · Arrow keys move between shapes'
        : 'Arrow keys move between shapes · Tab leaves the diagram';
    } else if (link) {
      const action = link.getAttribute('aria-label') ?? 'Open link';
      text = `${activate} to ${action[0].toLowerCase()}${action.slice(1)}${source && input === 'mouse' ? ' · Alt+click selects source' : ''}`;
    } else if (shape && source) {
      text = `${activate} to select this shape’s source`;
    } else {
      const child = stage.querySelector('a[data-link-direction="child"]');
      const label = child?.querySelector('text')?.textContent?.trim();
      text = label ? `${activate} ${label} to explore`
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
  window.addEventListener('pointerdown', (event) => { input = event.pointerType === 'touch' ? 'touch' : 'mouse'; update(); });
  window.addEventListener('keydown', (event) => {
    if (['Tab', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
      input = 'keyboard'; update();
    }
  }, { capture: true });
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
