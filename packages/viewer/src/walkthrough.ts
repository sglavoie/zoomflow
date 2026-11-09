export type WalkthroughBoard = {
  id: string; name: string;
  shapes: { id: string; label: string; link?: string }[];
  connections: { id: string; from: string; to: string; label: string }[];
};

/** Self-contained: the same controller is serialized into offline HTML. Paths are chosen
 * by the reader, so decisions and loops never silently pick an outcome. */
export function setupWalkthrough(stage: HTMLElement, toolbar: HTMLElement, host: {
  boards(): Map<string, WalkthroughBoard>;
  current(): string;
  navigate(board: string): void | Promise<void>;
}) {
  const trigger = document.createElement('button');
  trigger.type = 'button'; trigger.className = 'zf-walkthrough-trigger'; trigger.textContent = 'Walkthrough';
  trigger.title = 'Walk through this diagram step by step';
  trigger.setAttribute('aria-label', 'Walkthrough');
  trigger.setAttribute('aria-pressed', 'false');
  toolbar.append(trigger);
  const panel = document.createElement('section');
  panel.className = 'zf-walkthrough'; panel.hidden = true; panel.setAttribute('aria-label', 'Diagram walkthrough');
  panel.innerHTML = '<div class="zf-walkthrough-heading"><span role="status" aria-live="polite"></span><div><button type="button" class="zf-present-toggle" aria-pressed="false">Present</button><button type="button" aria-label="End walkthrough">×</button></div></div><p></p><div class="zf-walkthrough-actions"></div>';
  stage.after(panel);
  const status = panel.querySelector('span')!;
  const help = panel.querySelector('p')!;
  const actions = panel.querySelector('.zf-walkthrough-actions')!;
  type Stop = { board: string; shape: string; edge?: string; returns: { board: string; shape: string }[] };
  let stops: Stop[] = [];
  let position = -1;
  let revision = 0;
  let navigating = false;
  let presenting = false;
  const area = stage.parentElement!;
  const title = document.createElement('div'); title.className = 'zf-present-title'; title.hidden = true;
  title.innerHTML = '<strong></strong><span></span>'; area.append(title);
  const present = panel.querySelector<HTMLButtonElement>('.zf-present-toggle')!;
  const inert = new Map<HTMLElement, boolean>();
  let edgeAnimation: Animation | undefined;
  function presentation(value: boolean) {
    if (presenting === value) return;
    presenting = value;
    title.hidden = !value;
    area.toggleAttribute('data-presentation', value);
    present.textContent = value ? 'Exit presentation' : 'Present';
    present.setAttribute('aria-pressed', String(value));
    if (value) {
      for (let element: HTMLElement | null = area; element && element !== document.body; element = element.parentElement) {
        for (const sibling of element.parentElement?.children ?? []) if (sibling !== element && sibling instanceof HTMLElement) {
          inert.set(sibling, sibling.inert); sibling.inert = true;
        }
      }
    } else { for (const [node, previous] of inert) node.inert = previous; inert.clear(); }
    stage.dispatchEvent(new CustomEvent('zf-presentationchange', { detail: { active: value } }));
    if (active()) render();
  }
  present.addEventListener('click', () => { presentation(!presenting); present.focus({ preventScroll: true }); });
  const events = new AbortController();
  area.addEventListener('keydown', event => {
    if (!presenting || event.defaultPrevented) return;
    if (event.key === 'Escape') {
      event.preventDefault(); event.stopImmediatePropagation(); presentation(false); present.focus({ preventScroll: true });
    } else if (event.key === 'Tab') {
      const targets = [...area.querySelectorAll<HTMLElement>('button:not(:disabled), [tabindex="0"]')].filter(node => node.getClientRects().length);
      const index = targets.indexOf(document.activeElement as HTMLElement);
      if (event.shiftKey && index <= 0 || !event.shiftKey && (index === targets.length - 1 || index < 0)) {
        event.preventDefault(); (event.shiftKey ? targets.at(-1) : targets[0])?.focus();
      }
    }
  }, { capture: true, signal: events.signal });
  const active = () => stops[position];
  const board = () => host.boards().get(host.current());
  const first = (next: WalkthroughBoard) => next.shapes.find(shape => !next.connections.some(edge => edge.to === shape.id)) ?? next.shapes[0];
  function detailStop(here: Stop): Stop | undefined {
    const shape = host.boards().get(here.board)?.shapes.find(shape => shape.id === here.shape);
    const detail = shape?.link ? host.boards().get(shape.link) : undefined;
    if (detail?.shapes.length) return {
      board: detail.id, shape: first(detail)!.id,
      returns: [...here.returns, { board: here.board, shape: here.shape }],
    };
  }
  function activate(target: HTMLElement) {
    const here = active();
    const model = board();
    const id = target.dataset.shapeId;
    if (!here || !model || target.dataset.shapeBoard && target.dataset.shapeBoard !== model.id
      || !model.shapes.some(shape => shape.id === id)) return;
    const stop: Stop = { board: model.id, shape: id!, returns: here.returns };
    const detail = detailStop(stop);
    if (detail) visit(detail);
    else if (here.board !== stop.board || here.shape !== stop.shape) visit(stop);
  }
  function clearMarks() {
    for (const element of stage.querySelectorAll('.zf-walkthrough-current, .zf-walkthrough-path, .zf-walkthrough-muted')) {
      element.classList.remove('zf-walkthrough-current', 'zf-walkthrough-path', 'zf-walkthrough-muted');
    }
  }
  function end(focus = true) {
    ++revision; navigating = false; stops = []; position = -1;
    if (presenting) presentation(false);
    edgeAnimation?.cancel();
    panel.hidden = true; delete stage.dataset.walkthrough;
    trigger.setAttribute('aria-pressed', 'false'); clearMarks();
    if (focus) trigger.focus({ preventScroll: true });
  }
  function button(label: string, run: () => void, disabled = false) {
    const element = document.createElement('button');
    element.type = 'button'; element.textContent = label; element.disabled = disabled;
    element.addEventListener('click', run); actions.append(element);
    return element;
  }
  function render() {
    clearMarks();
    const here = active();
    const model = here && host.boards().get(here.board);
    const shape = model?.shapes.find(item => item.id === here.shape);
    if (!here || !model || !shape || host.current() !== here.board) { if (!navigating) end(false); return; }
    title.querySelector('strong')!.textContent = document.querySelector('body > header > h1')?.textContent ?? toolbar.parentElement?.querySelector('.zf-breadcrumbs button')?.textContent ?? document.title;
    title.querySelector('span')!.textContent = document.querySelector('body > header > p')?.textContent ?? (model.id === 'root' ? 'Follow the idea, one step at a time' : model.name);
    panel.hidden = false; stage.dataset.walkthrough = 'true'; trigger.setAttribute('aria-pressed', 'true');
    status.textContent = `Step ${position + 1} · ${shape.label}`;
    const path = new Set(stops.slice(0, position + 1).filter(stop => stop.board === here.board).map(stop => stop.shape));
    const edges = new Set(stops.slice(0, position + 1).filter(stop => stop.board === here.board).map(stop => stop.edge));
    for (const element of stage.querySelectorAll<SVGGraphicsElement>('[data-shape-id]')) {
      const ownBoard = element.dataset.shapeBoard ?? here.board;
      const id = element.dataset.shapeId!;
      const current = ownBoard === here.board && id === here.shape;
      const visited = ownBoard === here.board && path.has(id);
      const target = element.closest('a') ?? element;
      target.classList.toggle('zf-walkthrough-current', current);
      target.classList.toggle('zf-walkthrough-path', visited && !current);
      target.classList.toggle('zf-walkthrough-muted', !visited);
    }
    for (const element of stage.querySelectorAll<SVGElement>('[data-connection-id]')) {
      element.classList.toggle('zf-walkthrough-muted', !edges.has(element.dataset.connectionId));
    }
    actions.replaceChildren();
    button('Back', () => { if (position > 0) { --position; void show(); } }, position === 0);
    const outgoing = model.connections.filter(edge => edge.from === here.shape && model.shapes.some(shape => shape.id === edge.to));
    const detail = detailStop(here);
    if (detail) button(`Explore ${host.boards().get(detail.board)!.name}`, () => visit(detail));
    for (const edge of outgoing) {
      const label = model.shapes.find(shape => shape.id === edge.to)!.label;
      button(outgoing.length === 1 ? `Next: ${label}` : `${edge.label || 'Continue'} → ${label}`,
        () => visit({ ...here, shape: edge.to, edge: edge.id }));
    }
    if (!outgoing.length && here.returns.length) {
      const parent = here.returns.at(-1)!;
      button(`Return to ${host.boards().get(parent.board)?.name ?? 'parent board'}`, () => visit({ ...parent, returns: here.returns.slice(0, -1) }));
    }
    if (!outgoing.length && !here.returns.length) button('Finish', () => end());
    help.textContent = outgoing.length > 1 ? 'Choose the branch you want to explain.'
      : !outgoing.length ? 'End of this path. Choose another step, go back, or finish.'
      : 'Follow this path, explore its details, or select another step.';
    if (stops.length >= 500) help.textContent = 'This walkthrough has 500 steps. End it and start a new path to continue.';
    const neighbors = model.connections.filter(edge => edge.from === here.shape || edge.to === here.shape).flatMap(edge => [edge.from, edge.to]);
    stage.dispatchEvent(new CustomEvent('zf-walkthroughstep', { detail: { board: here.board, shape: here.shape,
      neighbors: [...new Set(neighbors)].slice(0, 6), presenting } }));
    edgeAnimation?.cancel();
    if (here.edge && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
      const edge = [...stage.querySelectorAll<SVGElement>('[data-connection-id]')].find(element => element.dataset.connectionId === here.edge);
      const path = edge?.querySelector<SVGPathElement>('path.connection');
      if (path) {
        const length = path.getTotalLength();
        edgeAnimation = path.animate([{ strokeDasharray: `${length}`, strokeDashoffset: length }, { strokeDasharray: `${length}`, strokeDashoffset: 0 }],
          { duration: 360, easing: 'ease-out' });
      }
    }
  }
  async function show() {
    const here = active();
    if (!here) return;
    const request = ++revision;
    navigating = true;
    for (const button of actions.querySelectorAll('button')) button.disabled = true;
    try {
      if (host.current() !== here.board) await host.navigate(here.board);
      if (request !== revision) return;
      navigating = false;
      render();
      // Keep keyboard focus in the controller, without invoking the shape's edit actions.
      if (panel.contains(document.activeElement) || document.activeElement === document.body) {
        (actions.querySelector('button:not(:disabled)') as HTMLButtonElement | null)?.focus({ preventScroll: true });
      }
    } catch {
      if (request === revision) { navigating = false; end(); }
    }
  }
  function visit(stop: Stop) {
    if (navigating || stops.length >= 500) return;
    stops = [...stops.slice(0, position + 1), stop]; position = stops.length - 1;
    void show();
  }
  function start(presenting = false) {
    if (active()) { if (presenting) presentation(true); return; }
    const model = board();
    if (!model?.shapes.length) return;
    const selected = stage.querySelector<HTMLElement>('.zf-canvas-selected')?.dataset.shapeId;
    visit({ board: model.id, shape: model.shapes.find(shape => shape.id === selected)?.id ?? first(model)!.id, returns: [] });
    if (presenting) { presentation(true); present.focus({ preventScroll: true }); }
  }
  trigger.addEventListener('click', () => { if (active()) end(); else start(); });
  panel.querySelector('[aria-label="End walkthrough"]')!.addEventListener('click', () => end());
  panel.addEventListener('keydown', event => {
    // Keep viewer Backspace/Escape navigation out of presentation controls.
    event.stopPropagation();
    if (event.key === 'Escape') { event.preventDefault(); end(); }
  });
  stage.addEventListener('click', event => {
    if (!active()) return;
    const target = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-shape-id]') ?? event.target.closest('a')?.querySelector<HTMLElement>('[data-shape-id]') : null;
    if (!target) return;
    event.preventDefault(); event.stopImmediatePropagation();
    activate(target);
  }, { capture: true });
  stage.addEventListener('keydown', event => {
    if (!active()) return;
    if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); end(); }
    else if (['Enter', ' ', 'F2', 'Delete', 'Backspace', 'Insert', 'h', 'H'].includes(event.key)) {
      event.preventDefault(); event.stopImmediatePropagation();
      const target = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-shape-id]') ?? event.target.closest('a')?.querySelector<HTMLElement>('[data-shape-id]') : null;
      if ((event.key === 'Enter' || event.key === ' ') && target) activate(target);
    }
  }, { capture: true });
  stage.addEventListener('zf-boardchange', () => { if (active() && !navigating) end(false); });
  stage.addEventListener('zf-sourcechange', () => end(false));
  stage.addEventListener('zf-visibilitychange', () => end(false));
  stage.addEventListener('zf-suspend', () => end(false));
  stage.addEventListener('zf-destroy', () => { end(false); events.abort(); trigger.remove(); panel.remove(); title.remove(); });
  return {
    start,
    refresh() { trigger.disabled = !board()?.shapes.length; if (active() && !navigating) render(); },
    end,
  };
}
