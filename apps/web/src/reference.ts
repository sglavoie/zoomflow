import { referenceTopics } from './reference-data';
import { d2HighlightRanges } from './d2-language';

/** Build text nodes only, preserving exact copy text and syntax colors under matches. */
function renderMatches(element: HTMLElement, source: string, terms: string[], syntax = false) {
  const tokens = syntax ? d2HighlightRanges(source) : [];
  const matches: { from: number; to: number }[] = [];
  const lower = source.toLowerCase();
  for (const term of terms) {
    for (let from = lower.indexOf(term); from !== -1; from = lower.indexOf(term, from + term.length)) {
      matches.push({ from, to: from + term.length });
    }
  }
  const boundaries = [...new Set([0, source.length, ...tokens.flatMap(({ from, to }) => [from, to]),
    ...matches.flatMap(({ from, to }) => [from, to])])].sort((a, b) => a - b);
  const fragment = document.createDocumentFragment();
  for (let i = 1; i < boundaries.length; i++) {
    const from = boundaries[i - 1], to = boundaries[i];
    const token = tokens.find((token) => token.from <= from && token.to >= to);
    const matched = matches.some((match) => match.from <= from && match.to >= to);
    const text = source.slice(from, to);
    if (!token && !matched) fragment.append(text);
    else {
      const node = document.createElement(matched ? 'mark' : 'span');
      if (token) node.className = token.className;
      node.textContent = text;
      fragment.append(node);
    }
  }
  element.replaceChildren(fragment);
}

type ReferenceHost = { preview: HTMLElement; source: HTMLElement; showPreview: () => void; showSource: () => void };

/** App-only reference UI; the viewer and exported diagrams remain independent.
 * One panel serves the workspace: it opens below the diagram of the pane being worked in.
 */
export function setupReference(host: () => ReferenceHost) {
  let target = host();
  let preview = target.preview;
  const panel = document.querySelector<HTMLElement>('#d2-reference')!;
  const toggle = document.querySelector<HTMLButtonElement>('#toggle-reference')!;
  const close = document.querySelector<HTMLButtonElement>('#close-reference')!;
  const divider = document.querySelector<HTMLElement>('#reference-divider')!;
  const search = document.querySelector<HTMLInputElement>('#reference-search')!;
  const content = document.querySelector<HTMLElement>('#reference-content')!;
  const count = document.querySelector<HTMLElement>('#reference-count')!;
  const status = document.querySelector<HTMLElement>('#reference-status')!;
  let returnFocus: HTMLElement | SVGElement | undefined;
  let scrollTop = 0;
  const defaultShare = 60;
  let diagramShare = defaultShare;
  let drag: { pointer: number; offset: number } | undefined;
  const storageKey = 'zoomflow.reference.diagram-share';
  try {
    const stored = Number(localStorage.getItem(storageKey));
    if (Number.isFinite(stored) && stored >= 25 && stored <= 75) diagramShare = stored;
  } catch { /* The reference also works when storage is unavailable. */ }

  function setShare(value: number) {
    diagramShare = Math.max(25, Math.min(75, value));
    preview.style.setProperty('--diagram-share', `${diagramShare}fr`);
    preview.style.setProperty('--reference-share', `${100 - diagramShare}fr`);
    divider.setAttribute('aria-valuenow', String(Math.round(diagramShare)));
    divider.setAttribute('aria-valuetext', `Diagram ${Math.round(diagramShare)}%, reference ${Math.round(100 - diagramShare)}%`);
  }
  function saveShare() {
    try { localStorage.setItem(storageKey, String(diagramShare)); }
    catch { /* Resizing does not depend on storage. */ }
  }
  divider.setAttribute('aria-valuemin', '25');
  divider.setAttribute('aria-valuemax', '75');
  setShare(diagramShare);

  const cards = referenceTopics.map((topic) => {
    const card = document.createElement('section');
    card.className = 'reference-topic';
    card.setAttribute('aria-labelledby', `reference-${topic.id}`);
    const titleRow = document.createElement('div');
    titleRow.className = 'reference-example-title';
    const title = document.createElement('h3');
    title.id = `reference-${topic.id}`;
    title.textContent = topic.title;
    const copy = document.createElement('button');
    copy.textContent = 'Copy';
    copy.setAttribute('aria-label', `Copy ${topic.title} example`);
    let copyTimer: ReturnType<typeof setTimeout> | undefined;
    const description = document.createElement('p');
    description.textContent = topic.description;
    const pre = document.createElement('pre');
    const code = document.createElement('code');
    code.textContent = topic.source;
    pre.append(code);
    const docs = document.createElement('a');
    docs.href = topic.docs;
    docs.target = '_blank';
    docs.rel = 'noopener noreferrer';
    docs.textContent = `${topic.title} docs ↗`;
    copy.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(topic.source);
        clearTimeout(copyTimer);
        copy.textContent = 'Copied';
        copyTimer = setTimeout(() => { copy.textContent = 'Copy'; }, 2000);
        status.textContent = `Copied ${topic.title} example.`;
      } catch {
        clearTimeout(copyTimer);
        copy.textContent = 'Copy';
        const selection = window.getSelection();
        const range = document.createRange();
        range.selectNodeContents(code);
        selection?.removeAllRanges();
        selection?.addRange(range);
        status.textContent = 'Clipboard unavailable. Example selected; press ⌘C or Ctrl+C to copy.';
      }
    });
    titleRow.append(title, copy);
    card.append(titleRow, description, pre, docs);
    content.append(card);
    return { card, title, description, code, topic,
      text: `${topic.title} ${topic.description} ${topic.keywords} ${topic.source}`.toLowerCase() };
  });
  const empty = document.createElement('p');
  empty.textContent = 'No matching syntax. Try “arrows”, “style”, or “layers”.';
  content.append(empty);
  function filter() {
    const terms = search.value.toLowerCase().trim().split(/\s+/).filter(Boolean);
    let matches = 0;
    for (const { card, text, title, description, code, topic } of cards) {
      card.hidden = !terms.every((term) => text.includes(term));
      if (!card.hidden) {
        ++matches;
        renderMatches(title, topic.title, terms);
        renderMatches(description, topic.description, terms);
        renderMatches(code, topic.source, terms, true);
      }
    }
    empty.hidden = matches > 0;
    count.textContent = `${matches} topic${matches === 1 ? '' : 's'}`;
    content.scrollTop = 0;
    status.textContent = '';
  }
  search.addEventListener('input', filter);
  filter();

  function setOpen(open: boolean) {
    if (open === !panel.hidden) return;
    const active = document.activeElement;
    if (open) {
      returnFocus = (active instanceof HTMLElement || active instanceof SVGElement) && active !== document.body ? active : toggle;
      move(host());
    } else scrollTop = content.scrollTop;
    panel.hidden = !open;
    divider.hidden = !open;
    preview.classList.toggle('reference-open', open);
    toggle.setAttribute('aria-expanded', String(open));
    if (open) {
      target.showPreview();
      search.focus({ preventScroll: true });
      content.scrollTop = scrollTop;
    } else {
      if (drag) finishDrag();
      if (active instanceof Node && (panel.contains(active) || active === divider)) {
        if (returnFocus && target.source.contains(returnFocus)) target.showSource();
        (returnFocus?.isConnected ? returnFocus : toggle).focus({ preventScroll: true });
      }
    }
  }
  function move(next: ReferenceHost) {
    if (next.preview === preview) return;
    preview.classList.remove('reference-open');
    target = next;
    preview = next.preview;
    preview.append(divider, panel);
    preview.classList.toggle('reference-open', !panel.hidden);
    setShare(diagramShare);
  }
  toggle.setAttribute('aria-keyshortcuts', 'Meta+Shift+/ Control+Shift+/');
  toggle.addEventListener('click', () => {
    // Safari does not focus buttons on pointer clicks. Set focus explicitly so
    // opening/closing from a button has the same return target in every browser.
    toggle.focus({ preventScroll: true });
    setOpen(Boolean(panel.hidden));
  });
  close.addEventListener('click', () => {
    close.focus({ preventScroll: true });
    setOpen(false);
  });
  // Leave Mod-/ to the editor's comment command.
  window.addEventListener('keydown', (event) => {
    if (event.isComposing || event.altKey || !event.shiftKey || !(event.metaKey || event.ctrlKey) ||
        !(event.key === '/' || event.key === '?' || event.code === 'Slash')) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (!event.repeat) setOpen(Boolean(panel.hidden));
  }, { capture: true });
  panel.addEventListener('keydown', (event) => {
    // Reference controls must not invoke the viewer's Escape/Backspace navigation.
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
    } else if (event.key === 'Backspace') {
      event.stopPropagation();
      if (!(event.target instanceof HTMLInputElement)) event.preventDefault();
    }
  });

  divider.addEventListener('keydown', (event) => {
    const next = event.key === 'ArrowUp' ? diagramShare - 5
      : event.key === 'ArrowDown' ? diagramShare + 5
      : event.key === 'Home' ? 25 : event.key === 'End' ? 75 : undefined;
    if (next !== undefined) {
      event.preventDefault();
      setShare(next);
      saveShare();
    } else if (event.key === 'Escape' || event.key === 'Backspace') {
      event.preventDefault();
      event.stopPropagation();
      if (event.key === 'Escape') setOpen(false);
    }
  });
  divider.addEventListener('pointerdown', (event) => {
    if (event.button !== 0 || drag) return;
    event.preventDefault();
    divider.focus({ preventScroll: true });
    drag = { pointer: event.pointerId, offset: event.clientY - divider.getBoundingClientRect().top };
    divider.setPointerCapture(event.pointerId);
  });
  divider.addEventListener('pointermove', (event) => {
    if (drag?.pointer !== event.pointerId) return;
    const bounds = preview.getBoundingClientRect();
    const available = bounds.height - divider.getBoundingClientRect().height;
    if (available > 0) setShare((event.clientY - bounds.top - drag.offset) / available * 100);
  });
  function finishDrag() {
    const pointer = drag?.pointer;
    drag = undefined;
    if (pointer !== undefined && divider.hasPointerCapture(pointer)) divider.releasePointerCapture(pointer);
    saveShare();
  }
  divider.addEventListener('pointerup', finishDrag);
  divider.addEventListener('pointercancel', finishDrag);
  divider.addEventListener('lostpointercapture', finishDrag);
  divider.addEventListener('dblclick', () => {
    setShare(defaultShare);
    saveShare();
  });
  return {
    /** Close the reference and return it to the given pane, for example when its pane closes. */
    reset(next: ReferenceHost) {
      if (!panel.hidden && preview !== next.preview) setOpen(false);
      move(next);
    },
  };
}
