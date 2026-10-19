/** Self-contained so the same accessible navigation ships in offline HTML. */
export function setupBreadcrumbs(container: HTMLElement) {
  const events = new AbortController();
  const options = { signal: events.signal };
  let trigger: HTMLButtonElement | undefined;
  const menu = document.createElement('div');
  menu.className = 'zf-ancestor-menu';
  menu.id = `zf-ancestors-${Math.random().toString(36).slice(2)}`;
  menu.setAttribute('role', 'group');
  menu.setAttribute('aria-label', 'Earlier boards');
  menu.hidden = true;
  function close(focus = false) {
    menu.hidden = true;
    trigger?.setAttribute('aria-expanded', 'false');
    if (focus) trigger?.focus({ preventScroll: true });
  }
  function position() {
    if (menu.hidden || !trigger) return;
    const bounds = trigger.getBoundingClientRect();
    menu.style.left = `${Math.max(8, Math.min(bounds.left, innerWidth - menu.offsetWidth - 8))}px`;
    menu.style.top = `${bounds.bottom + 6}px`;
    menu.style.maxHeight = `${Math.max(44, innerHeight - bounds.bottom - 14)}px`;
  }
  document.addEventListener('click', event => {
    if (event.target instanceof Node && !container.contains(event.target)) close();
  }, options);
  container.addEventListener('focusout', event => {
    if (event.relatedTarget instanceof Node && !container.contains(event.relatedTarget)) close();
  }, options);
  container.addEventListener('keydown', event => {
    if (menu.hidden) return;
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(true); }
    if (event.key === 'Backspace') { event.preventDefault(); event.stopPropagation(); }
    const buttons = [...menu.querySelectorAll('button')];
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const next = event.key === 'ArrowDown' ? (index + 1) % buttons.length
      : event.key === 'ArrowUp' ? (index - 1 + buttons.length) % buttons.length
      : event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : undefined;
    if (next !== undefined) { event.preventDefault(); buttons[next]?.focus(); }
  }, options);
  window.addEventListener('resize', position, options);
  return {
    render(items: readonly { name: string; activate: () => void }[]) {
      close();
      trigger = undefined;
      container.replaceChildren();
      menu.replaceChildren();
      function button(index: number) {
        const item = items[index];
        const node = document.createElement('button');
        node.type = 'button';
        node.textContent = item.name;
        node.title = item.name;
        if (index === items.length - 1) node.setAttribute('aria-current', 'page');
        node.onclick = () => { close(); item.activate(); };
        return node;
      }
      function append(node: HTMLElement) {
        if (container.childElementCount) {
          const separator = document.createElement('span');
          separator.className = 'zf-crumb-separator';
          separator.textContent = '/';
          separator.setAttribute('aria-hidden', 'true');
          container.append(separator);
        }
        container.append(node);
      }
      items.forEach((_item, index) => {
        if (items.length > 3 && index > 0 && index < items.length - 2) {
          menu.append(button(index));
          if (index !== 1) return;
          trigger = document.createElement('button');
          trigger.type = 'button';
          trigger.className = 'zf-ancestor-toggle';
          trigger.textContent = '…';
          trigger.setAttribute('aria-label', 'Earlier boards');
          trigger.setAttribute('aria-expanded', 'false');
          trigger.setAttribute('aria-controls', menu.id);
          trigger.onclick = () => {
            if (!menu.hidden) return close();
            menu.hidden = false;
            trigger!.setAttribute('aria-expanded', 'true');
            position();
            menu.querySelector('button')?.focus();
          };
          append(trigger);
        } else append(button(index));
      });
      container.append(menu);
    },
    destroy() { events.abort(); menu.remove(); },
  };
}
