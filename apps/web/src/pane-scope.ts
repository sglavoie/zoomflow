export type PaneId = 'a' | 'b';

/** Element lookups within one workspace pane. Modules ask for parts by name; only this
 * file knows that the second pane's element IDs carry a `-b` suffix.
 */
export type PaneScope = {
  pane: PaneId;
  root: HTMLElement;
  part<T extends HTMLElement = HTMLElement>(name: string): T;
  /** A page-unique ID for an element the pane creates at runtime. */
  id(name: string): string;
};

const suffix = (pane: PaneId) => pane === 'a' ? '' : '-b';

export function paneScope(pane: PaneId, root: HTMLElement): PaneScope {
  return {
    pane,
    root,
    part: <T extends HTMLElement>(name: string) => root.querySelector<T>(`[data-part="${name}"]`)!,
    id: (name) => `${name}${suffix(pane)}`,
  };
}

/** Name every element in the first pane's markup by its ID, so both panes find parts the same way. */
export function nameParts(root: HTMLElement) {
  for (const node of root.querySelectorAll<HTMLElement>('[id]')) node.dataset.part ??= node.id;
}

/** Copy the first pane's untouched markup for the second pane, giving every ID and ID
 * reference the second pane's suffix. Call `nameParts` on the first pane first.
 */
export function cloneSecondPane(first: HTMLElement, omit: string[]) {
  const copy = first.cloneNode(true) as HTMLElement;
  for (const selector of omit) copy.querySelector(selector)?.remove();
  for (const node of copy.querySelectorAll('*')) {
    if (node.id) node.id += suffix('b');
    for (const name of ['for', 'aria-controls', 'aria-describedby', 'aria-labelledby']) {
      const value = node.getAttribute(name);
      if (value) node.setAttribute(name, value.split(/\s+/).map((id) => `${id}${suffix('b')}`).join(' '));
    }
  }
  return copy;
}
