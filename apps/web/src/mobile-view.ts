/** One view at a time keeps the editor and diagram usable on narrow screens and in tabbed panes. */
export function setupMobileView(pane: HTMLElement, preview: HTMLButtonElement, source: HTMLButtonElement,
  tabbed: () => boolean, onPreview: () => void) {
  const workspace = document.querySelector<HTMLElement>('#workspace')!;
  function show(view: 'preview' | 'source') {
    pane.dataset.view = view;
    workspace.scrollTop = 0;
    preview.setAttribute('aria-pressed', String(view === 'preview'));
    source.setAttribute('aria-pressed', String(view === 'source'));
    if (view === 'preview' && tabbed()) requestAnimationFrame(onPreview);
  }
  preview.addEventListener('click', () => show('preview'));
  source.addEventListener('click', () => show('source'));
  show('preview');
  return {
    show,
    get view() { return pane.dataset.view as 'preview' | 'source'; },
    /** Keep the editor visible when tabs appear while it has focus. */
    layoutChanged() {
      if (tabbed() && pane.querySelector('[id^="source-pane"]')!.contains(document.activeElement)) show('source');
      else if (!tabbed() || pane.dataset.view === 'preview') requestAnimationFrame(onPreview);
    },
  };
}

/** iOS can shrink only the visual viewport when the software keyboard opens.
 * Do not constrain the layout during pinch magnification (browser accessibility zoom).
 */
export function setupViewportHeight(mobile: MediaQueryList) {
  function resizeViewport() {
    const viewport = window.visualViewport;
    if (mobile.matches && viewport && viewport.scale === 1) {
      document.body.style.setProperty('--workspace-height', `${viewport.height}px`);
    } else document.body.style.removeProperty('--workspace-height');
  }
  window.visualViewport?.addEventListener('resize', resizeViewport);
  window.addEventListener('resize', resizeViewport);
  mobile.addEventListener('change', resizeViewport);
  resizeViewport();
}
