/** Decorative UI icons share a 24-unit grid and a 1.75-unit stroke. */
const svg = (body: string) => `<svg class="ui-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${body}</svg>`;

export const icons = {
  boards: svg('<rect x="3" y="3" width="12" height="12" rx="2"/><path d="M9 18v3h12V9h-3"/>'),
  edit: svg('<path d="m4 16-1 5 5-1L21 7l-4-4L4 16Zm10-10 4 4"/>'),
  search: svg('<circle cx="10" cy="10" r="6"/><path d="m15 15 6 6"/>'),
  style: svg('<path d="m14 3 7 7-8 8-7-7 8-8ZM4 13l7 7M3 21h6"/>'),
  fullscreen: svg('<path d="M9 3H3v6m12-6h6v6M3 15v6h6m12-6v6h-6"/>'),
  export: svg('<path d="M12 3v12m-4-4 4 4 4-4M4 15v6h16v-6"/>'),
  source: svg('<path d="m7 6-5 6 5 6m10-12 5 6-5 6M14 3l-4 18"/>'),
  add: svg('<path d="M4 12h16m-5-5 5 5-5 5M5 3v6m-3-3h6"/>'),
  branch: svg('<path d="M4 20v-8a4 4 0 0 1 4-4h12m-5-5 5 5-5 5M4 16h16m-5-5 5 5-5 5"/>'),
  connect: svg('<rect x="2" y="8" width="5" height="8" rx="1"/><rect x="17" y="8" width="5" height="8" rx="1"/><path d="M7 12h10m-3-3 3 3-3 3"/>'),
  move: svg('<path d="M12 3v18M3 12h18M8 7l4-4 4 4M8 17l4 4 4-4M7 8l-4 4 4 4m10-8 4 4-4 4"/>'),
  link: svg('<path d="m10 8 3-3a4 4 0 0 1 6 6l-3 3m-2 2-3 3a4 4 0 0 1-6-6l3-3m1 7 6-10"/>'),
  unlink: svg('<path d="m14 7 2-2a3 3 0 0 1 4 4l-2 2M6 13l-2 2a3 3 0 0 0 5 5l2-2M3 3l18 18"/>'),
  hide: svg('<path d="M3 3l18 18M10 5h2c5 0 9 7 9 7l-3 4M6 6c-2 2-4 6-4 6s4 7 10 7l3-1"/><path d="M9 9a4 4 0 0 0 6 6"/>'),
  show: svg('<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>'),
  delete: svg('<path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7"/>'),
};

/** Labels are text nodes: diagram-derived strings never become markup. */
export function iconLabel(element: HTMLElement, icon: keyof typeof icons, label: string) {
  element.innerHTML = icons[icon];
  element.append(document.createTextNode(label));
}
