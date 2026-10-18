import type { ParentContext } from '@zoomflow/core';

/** Shared with the standalone HTML runtime; render authored labels as plain text. */
export function renderParentContext(element: HTMLElement, contexts: readonly ParentContext[]) {
  element.replaceChildren();
  element.hidden = contexts.length === 0;
  for (const context of contexts) {
    const row = document.createElement('div');
    row.textContent = [context.label,
      context.incoming.length ? `From ${context.incoming.join(', ')}` : '',
      context.outgoing.length ? `To ${context.outgoing.join(', ')}` : '',
    ].filter(Boolean).join(' · ');
    element.append(row);
  }
}

/** Keep the visited path, removing each loop when it returns to an earlier board. */
export function simplifyTrail(visits: readonly string[]): string[] {
  const trail: string[] = [];
  for (const id of visits) {
    const previous = trail.indexOf(id);
    if (previous === -1) trail.push(id);
    else trail.length = previous + 1;
  }
  return trail;
}
