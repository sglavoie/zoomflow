/** One pane at a time keeps the editor and diagram usable on narrow screens. */
export function setupMobileView(onPreview: () => void) {
  const workspace = document.querySelector<HTMLElement>('#workspace')!;
  const preview = document.querySelector<HTMLButtonElement>('#mobile-preview')!;
  const source = document.querySelector<HTMLButtonElement>('#mobile-source')!;
  const mobile = matchMedia('(max-width: 999px)');
  function show(view: 'preview' | 'source') {
    workspace.dataset.mobileView = view;
    workspace.scrollTop = 0;
    preview.setAttribute('aria-pressed', String(view === 'preview'));
    source.setAttribute('aria-pressed', String(view === 'source'));
    if (view === 'preview' && mobile.matches) requestAnimationFrame(onPreview);
  }
  preview.addEventListener('click', () => show('preview'));
  source.addEventListener('click', () => show('source'));
  mobile.addEventListener('change', () => {
    if (mobile.matches && document.querySelector('#source-pane')!.contains(document.activeElement)) show('source');
    else if (!mobile.matches || workspace.dataset.mobileView === 'preview') requestAnimationFrame(onPreview);
  });
  show('preview');
  return show;
}
