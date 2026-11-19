import { boardPicture } from './board-picture';
import { createCompiler } from './compiler';
import { examples } from './examples';
import { projectFileSystem } from './project-files';

/** Idle, serial pictures of the bundled sources, never the user's edited drafts.
 * A separate, disposable worker keeps background jobs out of both panes' compiler
 * queue. Any foreground render (including the edit debounce) stops that worker.
 */
export function setupExamplePictures(picker: HTMLDetailsElement, buttons: Map<string, HTMLButtonElement>) {
  const pictures = new Map(examples.map(example => [example.name, buttons.get(example.name)!.querySelector<HTMLImageElement>('.example-picture img')!]));
  const sources = new Map<string, string>();
  const urls = new Map<string, string>();
  const failed = new Set<string>();
  let compiler: ReturnType<typeof createCompiler> | undefined;
  let active: object | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let idle: number | undefined;
  let previewReady = false;
  let stopped = false;
  let theme: boolean | undefined;
  const dark = () => document.documentElement.dataset.theme === 'dark';
  const key = (name: string) => `${name}:${dark()}`;
  function allowed() {
    return previewReady && !document.querySelector('[data-part="viewer"][aria-busy="true"]');
  }
  function cancel() {
    active = undefined;
    compiler?.dispose();
    compiler = undefined;
    if (idle !== undefined) window.cancelIdleCallback(idle);
    idle = undefined;
    clearTimeout(timer);
    timer = undefined;
  }
  function show() {
    for (const [name, picture] of pictures) {
      const url = urls.get(key(name));
      const slot = picture.parentElement!;
      slot.toggleAttribute('data-failed', failed.has(name));
      if (!url || picture.getAttribute('src') !== url) delete slot.dataset.ready;
      picture.hidden = !url;
      if (url && picture.getAttribute('src') !== url) picture.src = url;
      else if (url && picture.complete && picture.naturalWidth) slot.dataset.ready = 'true';
    }
  }
  async function next() {
    timer = undefined;
    idle = undefined;
    if (active || stopped || !allowed()) return;
    const example = examples.find(item => !failed.has(item.name) && !urls.has(key(item.name)));
    if (!example) { compiler?.dispose(); compiler = undefined; return; }
    const request = active = {};
    const currentTheme = dark();
    const currentKey = key(example.name);
    try {
      let svg = sources.get(example.name);
      if (!svg) {
        compiler ??= createCompiler();
        const { d2, fonts } = await compiler.get();
        if (active !== request) return;
        const compiled = await d2.compile(projectFileSystem(example.name, {}, example.source), {
          ...fonts, layout: 'elk', themeID: 0, darkThemeID: 200, pad: 40,
        });
        if (active !== request) return;
        svg = await d2.render(compiled.diagram, { ...compiled.renderOptions, target: '', noXMLTag: true });
        if (active !== request) return;
        sources.set(example.name, svg);
      }
      const url = await boardPicture(svg, currentTheme);
      if (active !== request) return;
      urls.set(currentKey, url);
      show();
    } catch {
      // Cancellation retries later; a real failure leaves this slot neutral.
      if (active === request) { failed.add(example.name); show(); }
    } finally {
      if (active === request) { active = undefined; refresh(); }
    }
  }
  function refresh() {
    if (!picker.isConnected) { dispose(); return; }
    if (stopped) return;
    previewReady ||= document.querySelector('[data-part="preview-status"]')?.getAttribute('data-state') === 'ready';
    if (theme !== dark()) { theme = dark(); cancel(); show(); }
    if (!allowed()) { cancel(); return; }
    // Each job waits for browser idle time; a busy event also cancels queued work.
    if (!active && timer === undefined && idle === undefined) {
      if (typeof window.requestIdleCallback === 'function') idle = window.requestIdleCallback(() => void next());
      else timer = setTimeout(() => void next(), 100);
    }
  }
  for (const picture of pictures.values()) picture.addEventListener('load', loaded);
  function loaded(event: Event) {
    const picture = event.currentTarget as HTMLImageElement;
    if (!stopped && !picture.hidden && picture.naturalWidth) picture.parentElement!.dataset.ready = 'true';
  }
  const observer = new MutationObserver(refresh);
  observer.observe(document.documentElement, { subtree: true, attributes: true,
    attributeFilter: ['open', 'aria-busy', 'data-state', 'data-theme'] });
  function dispose() {
    stopped = true; cancel(); observer.disconnect();
    for (const picture of pictures.values()) picture.removeEventListener('load', loaded);
    removeEventListener('pagehide', dispose);
  }
  addEventListener('pagehide', dispose, { once: true });
  refresh();
  return { dispose };
}
