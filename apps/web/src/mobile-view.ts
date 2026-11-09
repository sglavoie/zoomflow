/** One view at a time keeps the editor and diagram usable on narrow screens and in tabbed panes. */
export function setupMobileView(pane: HTMLElement, preview: HTMLButtonElement, source: HTMLButtonElement,
  tabbed: () => boolean, onPreview: () => void) {
  const workspace = document.querySelector<HTMLElement>('#workspace')!;
  const preference = `zoomflow.source-visible.${pane.dataset.pane ?? 'a'}`;
  pane.setAttribute('data-source-hidden', '');
  try {
    let saved = localStorage.getItem(preference);
    // Keep the former split default for people with an existing workspace. Record the
    // fresh canvas default now, before the first draft writes its recovery selection.
    if (saved === null) {
      saved = localStorage.getItem('zoomflow.source-visible.a') ??
        (localStorage.getItem('zoomflow.selection.v2') || localStorage.getItem('zoomflow.drafts.v1') ? 'true' : 'false');
      localStorage.setItem(preference, saved);
    }
    pane.toggleAttribute('data-source-hidden', saved !== 'true');
  }
  catch { /* Optional preference. */ }
  function setSourceVisible(visible: boolean, remember = false) {
    pane.toggleAttribute('data-source-hidden', !visible);
    if (remember) {
      try { localStorage.setItem(preference, String(visible)); } catch { /* Keep the current layout. */ }
    }
    pane.dispatchEvent(new Event('zf-workspaceviewchange', { bubbles: true }));
    requestAnimationFrame(onPreview);
  }
  function show(view: 'preview' | 'source') {
    if (view === 'source' && !tabbed()) setSourceVisible(true);
    pane.dataset.view = view;
    workspace.scrollTop = 0;
    preview.setAttribute('aria-pressed', String(view === 'preview'));
    source.setAttribute('aria-pressed', String(view === 'source'));
    if (view === 'preview' && tabbed()) requestAnimationFrame(onPreview);
    pane.dispatchEvent(new Event('zf-workspaceviewchange', { bubbles: true }));
  }
  preview.addEventListener('click', () => show('preview'));
  source.addEventListener('click', () => show('source'));
  show('preview');
  return {
    show,
    get sourceVisible() { return tabbed() ? pane.dataset.view === 'source' : !pane.hasAttribute('data-source-hidden'); },
    toggleSource() {
      if (tabbed()) show(pane.dataset.view === 'source' ? 'preview' : 'source');
      else {
        const visible = pane.hasAttribute('data-source-hidden');
        if (!visible && pane.querySelector('[data-part="source-pane"]')?.contains(document.activeElement)) {
          pane.querySelector<HTMLElement>('.zf-stage')?.focus({ preventScroll: true });
        }
        setSourceVisible(visible, true);
      }
    },
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
