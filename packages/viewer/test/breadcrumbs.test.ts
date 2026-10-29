// @vitest-environment happy-dom
import { shapeClass, type Diagram } from '@zoomflow/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { setupBreadcrumbs } from '../src/breadcrumbs';
import { Viewer } from '../src/index';

let cleanup: (() => void) | undefined;
afterEach(() => { cleanup?.(); cleanup = undefined; document.body.replaceChildren(); });

function mount(names: string[]) {
  const container = document.createElement('nav');
  document.body.append(container);
  const crumbs = setupBreadcrumbs(container);
  cleanup = crumbs.destroy;
  const activated: string[] = [];
  crumbs.render(names.map((name) => ({ name, activate: () => activated.push(name) })));
  const visible = () => [...container.children].filter((node) => !node.classList.contains('zf-ancestor-menu'));
  const menu = container.querySelector<HTMLElement>('.zf-ancestor-menu')!;
  const toggle = container.querySelector<HTMLButtonElement>('.zf-ancestor-toggle');
  return { container, crumbs, activated, visible, menu, toggle };
}

const key = (target: Element, name: string) =>
  target.dispatchEvent(new KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true }));

describe('setupBreadcrumbs', () => {
  it('shows short trails in full with separators and marks the current board', () => {
    const { visible, toggle, activated } = mount(['Root', 'checkout', 'charge']);
    expect(toggle).toBeNull();
    expect(visible().map((node) => node.textContent)).toEqual(['Root', '/', 'checkout', '/', 'charge']);
    const buttons = visible().filter((node) => node.localName === 'button') as HTMLButtonElement[];
    expect(buttons.map((node) => node.getAttribute('aria-current'))).toEqual([null, null, 'page']);
    expect(visible().filter((node) => node.localName === 'span').every((node) => node.getAttribute('aria-hidden') === 'true')).toBe(true);
    buttons[1].click();
    expect(activated).toEqual(['checkout']);
  });

  it('moves focus to the menu toggle before a board picked from the menu opens, so navigation can restore it', () => {
    const container = document.createElement('nav');
    document.body.append(container);
    const crumbs = setupBreadcrumbs(container);
    cleanup = crumbs.destroy;
    let focused: Element | null = null;
    crumbs.render(['Root', 'a', 'b', 'c', 'd'].map((name) => ({ name, activate: () => { focused = document.activeElement; } })));
    const toggle = container.querySelector<HTMLButtonElement>('.zf-ancestor-toggle')!;
    toggle.click();
    container.querySelector<HTMLButtonElement>('.zf-ancestor-menu button')!.click();
    expect(focused).toBe(toggle);
  });

  it('collapses the middle of long trails behind an Earlier boards menu', () => {
    const { visible, toggle, menu } = mount(['Root', 'a', 'b', 'c', 'd', 'e']);
    expect(visible().map((node) => node.textContent)).toEqual(['Root', '/', '…', '/', 'd', '/', 'e']);
    expect(toggle!.getAttribute('aria-label')).toBe('Earlier boards');
    expect(toggle!.getAttribute('aria-controls')).toBe(menu.id);
    expect(toggle!.getAttribute('aria-expanded')).toBe('false');
    expect(menu.hidden).toBe(true);
    expect([...menu.querySelectorAll('button')].map((node) => node.textContent)).toEqual(['a', 'b', 'c']);
  });

  it('opens the menu with focus on the first board, cycles with arrows and closes on Escape', () => {
    const { toggle, menu } = mount(['Root', 'a', 'b', 'c', 'd']);
    toggle!.click();
    expect(menu.hidden).toBe(false);
    expect(toggle!.getAttribute('aria-expanded')).toBe('true');
    const items = [...menu.querySelectorAll('button')];
    expect(document.activeElement).toBe(items[0]);
    key(items[0], 'ArrowUp');
    expect(document.activeElement).toBe(items[1]);
    key(items[1], 'ArrowDown');
    expect(document.activeElement).toBe(items[0]);
    key(items[0], 'End');
    expect(document.activeElement).toBe(items[1]);
    key(items[1], 'Home');
    expect(document.activeElement).toBe(items[0]);
    const escapeKey = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    items[0].dispatchEvent(escapeKey);
    expect(escapeKey.defaultPrevented).toBe(true);
    expect(menu.hidden).toBe(true);
    expect(toggle!.getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(toggle);
  });

  it('moves from the toggle to the last board with ArrowUp and the first with ArrowDown', () => {
    const { toggle, menu } = mount(['Root', 'a', 'b', 'c', 'd', 'e']);
    toggle!.click();
    const items = [...menu.querySelectorAll('button')];
    toggle!.focus();
    key(toggle!, 'ArrowUp');
    expect(document.activeElement).toBe(items.at(-1));
    toggle!.focus();
    key(toggle!, 'ArrowDown');
    expect(document.activeElement).toBe(items[0]);
  });

  it('places the menu right after its toggle in tab order', () => {
    const { container, toggle, menu } = mount(['Root', 'a', 'b', 'c', 'd']);
    expect(toggle!.nextElementSibling).toBe(menu);
    expect(container.lastElementChild!.textContent).toBe('d');
  });

  it('closes when focus leaves the menu and its toggle, but not when moving between them', () => {
    const { container, toggle, menu } = mount(['Root', 'a', 'b', 'c', 'd']);
    const focusFrom = (from: Element, to: Element | null) =>
      from.dispatchEvent(new FocusEvent('focusout', { bubbles: true, relatedTarget: to }));
    toggle!.click();
    const items = [...menu.querySelectorAll('button')];
    focusFrom(items[0], items[1]);
    focusFrom(items[1], toggle);
    expect(menu.hidden).toBe(false);
    focusFrom(toggle!, container.querySelector('button[aria-current]'));
    expect(menu.hidden).toBe(true);
    expect(toggle!.getAttribute('aria-expanded')).toBe('false');
  });

  it('activates a collapsed board and closes the menu', () => {
    const { toggle, menu, activated } = mount(['Root', 'a', 'b', 'c', 'd']);
    toggle!.click();
    menu.querySelectorAll('button')[1].click();
    expect(activated).toEqual(['b']);
    expect(menu.hidden).toBe(true);
  });

  it('closes on a click outside and stops listening after destroy', () => {
    const { toggle, menu, crumbs, container } = mount(['Root', 'a', 'b', 'c', 'd']);
    const outside = document.createElement('button');
    document.body.append(outside);
    toggle!.click();
    outside.click();
    expect(menu.hidden).toBe(true);
    toggle!.click();
    crumbs.destroy();
    expect(container.contains(menu)).toBe(false);
    outside.click();
    // The detached menu keeps its state because the document listener is gone.
    expect(menu.hidden).toBe(false);
  });

  it('rerenders without keeping the previous menu entries', () => {
    const { crumbs, container } = mount(['Root', 'a', 'b', 'c', 'd']);
    crumbs.render([{ name: 'Root', activate: () => {} }]);
    expect(container.querySelector('.zf-ancestor-toggle')).toBeNull();
    expect(container.querySelector('.zf-ancestor-menu')!.childElementCount).toBe(0);
    expect(container.querySelector('button')!.getAttribute('aria-current')).toBe('page');
  });
});

describe('Viewer trail prefix', () => {
  it('renders the files this one was opened from before its own boards', async () => {
    const shape = (id: string, link = '') => ({ id, link }) as unknown as Diagram['shapes'][number];
    const diagram = { name: '', shapes: [shape('a')], connections: [], layers: [{ name: 'Sleep', shapes: [shape('b')], connections: [] }] } as unknown as Diagram;
    const host = document.createElement('div');
    document.body.append(host);
    const viewer = new Viewer(host, { history: false });
    cleanup = () => viewer.destroy();
    await viewer.setDocument(diagram, async (target) =>
      `<svg xmlns="http://www.w3.org/2000/svg"><g class="${shapeClass(target ? 'b' : 'a')}"><rect/></g></svg>`);
    const names = () => [...host.querySelectorAll('.zf-breadcrumbs > button')].map((node) => node.textContent);
    const life = vi.fn();
    viewer.setTrailPrefix([{ name: 'Life', activate: life }]);
    expect(names()).toEqual(['Life', 'Root']);
    await viewer.navigate('root.layers.Sleep');
    expect(names()).toEqual(['Life', 'Root', 'Sleep']);
    expect(host.querySelector('button[aria-current]')!.textContent).toBe('Sleep');
    host.querySelector<HTMLButtonElement>('.zf-breadcrumbs > button')!.click();
    expect(life).toHaveBeenCalledOnce();
    // A long cross-file trail collapses its middle like a long board trail.
    viewer.setTrailPrefix([{ name: 'Life', activate: life }, { name: 'Health', activate: life }]);
    expect(names()).toEqual(['Life', '…', 'Root', 'Sleep']);
    viewer.setTrailPrefix([]);
    expect(names()).toEqual(['Root', 'Sleep']);
  });

  it('navigates while a new document renders without naming boards it no longer has', async () => {
    const shape = (id: string) => ({ id, link: '' }) as unknown as Diagram['shapes'][number];
    const layer = (name: string) => ({ name, shapes: [shape('x')], connections: [] });
    const diagram = (...layers: string[]) => ({ name: '', shapes: [shape('a')], connections: [], layers: layers.map(layer) }) as unknown as Diagram;
    const svg = '<svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>';
    const host = document.createElement('div');
    document.body.append(host);
    const viewer = new Viewer(host, { history: false });
    cleanup = () => viewer.destroy();
    await viewer.setDocument(diagram('L', 'M'), async () => svg);
    await viewer.navigate('root.layers.L');
    let release!: () => void;
    const rendering = new Promise<void>((resolve) => { release = resolve; });
    // L is gone from the new document, but a link in the board still shown can lead on before it renders.
    const pending = viewer.setDocument(diagram('M'), async () => { await rendering; return svg; });
    const opened = viewer.navigate('root.layers.M');
    release();
    await Promise.all([pending, opened]);
    expect(host.querySelector('[role="alert"]')!.textContent).toBe('');
    expect([...host.querySelectorAll('.zf-breadcrumbs > button')].map((node) => node.textContent)).not.toContain('L');
  });
});
