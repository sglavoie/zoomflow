// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { clampBox, createViewport, revealBox } from '../src/viewport';

globalThis.ResizeObserver ??= class { observe() {} disconnect() {} } as unknown as typeof ResizeObserver;

function mount() {
  const host = document.createElement('div');
  const stage = document.createElement('div');
  host.append(stage);
  document.body.append(host);
  stage.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><a href="root.layers.x" tabindex="0"><rect width="10" height="10"/></a></svg>';
  const svg = stage.querySelector('svg')!;
  // happy-dom does no layout: give the stage a size and the SVG an identity screen transform.
  for (const key of ['clientWidth', 'clientHeight'] as const) Object.defineProperty(stage, key, { value: 100 });
  stage.getClientRects = () => [new DOMRect(0, 0, 100, 100)] as unknown as DOMRectList;
  svg.getScreenCTM = () => new DOMMatrix() as unknown as SVGMatrix;
  svg.getBoundingClientRect = () => new DOMRect(0, 0, 100, 100);
  const frame = vi.fn(revealBox);
  createViewport(stage, host, clampBox, frame);
  const [out, amount, fit, inside] = [...host.querySelector('.zf-zoom-controls')!.children] as HTMLButtonElement[];
  return { stage, link: stage.querySelector('a')!, frame, out, amount, fit, inside };
}

afterEach(() => { document.body.replaceChildren(); });

describe('createViewport', () => {
  it('names the zoom level as a status', () => {
    const { amount, inside } = mount();
    expect(amount.getAttribute('role')).toBe('status');
    inside.click();
    expect(amount.getAttribute('aria-label')).toBe('150% of fitted size');
  });

  it('keeps keyboard focus on the zoom controls when a press disables its button', () => {
    const { out, fit, inside } = mount();
    inside.click();
    fit.focus();
    fit.click();
    expect(fit.disabled).toBe(true);
    expect(document.activeElement).toBe(out);
    for (let i = 0; i < 10; i++) inside.click();
    inside.focus();
    inside.click();
    expect(inside.disabled).toBe(true);
    expect(document.activeElement).toBe(out);
  });

  it('claims held Space repeats while panning, so the page does not scroll', () => {
    const { stage, inside } = mount();
    inside.click();
    stage.dispatchEvent(new PointerEvent('pointerenter'));
    const first = new KeyboardEvent('keydown', { code: 'Space', cancelable: true });
    window.dispatchEvent(first);
    const repeat = new KeyboardEvent('keydown', { code: 'Space', repeat: true, cancelable: true });
    window.dispatchEvent(repeat);
    expect(first.defaultPrevented).toBe(true);
    expect(repeat.defaultPrevented).toBe(true);
  });

  it('reveals a shape focused from the keyboard, not one focused by a click', () => {
    const { link, frame } = mount();
    link.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    link.focus();
    expect(frame).not.toHaveBeenCalled();
    link.blur();
    vi.spyOn(performance, 'now').mockReturnValue(performance.now() + 1000);
    link.focus();
    expect(frame).toHaveBeenCalledOnce();
    vi.restoreAllMocks();
  });
});
