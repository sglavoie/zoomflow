/** Explicit choices only: descendants hidden by a parent are derived from the current diagram. */
export type DocumentView = {
  hidden?: [string, string[]][];
  layers?: { root?: string; expanded: string[]; all: boolean; depth?: number };
};

/** Invalid view metadata must never prevent source recovery. */
export function parseDocumentView(value?: string): DocumentView {
  try {
    const data = JSON.parse(value ?? 'null');
    if (data?.version !== 1) return {};
    const view: DocumentView = {};
    if (Array.isArray(data.hidden) && data.hidden.every((entry: unknown) => Array.isArray(entry) && entry.length === 2 &&
      typeof entry[0] === 'string' && Array.isArray(entry[1]) && entry[1].every((id: unknown) => typeof id === 'string'))) view.hidden = data.hidden;
    const layers = data.layers;
    if (layers && (layers.root === undefined || typeof layers.root === 'string') && typeof layers.all === 'boolean' &&
      Array.isArray(layers.expanded) && layers.expanded.every((id: unknown) => typeof id === 'string') &&
      (layers.depth === undefined || Number.isSafeInteger(layers.depth) && layers.depth >= 0)) view.layers = layers;
    return view;
  } catch { return {}; }
}

/** Keep the default view absent, so merely opening an example does not create a draft. */
export function serializeDocumentView(view: DocumentView): string | undefined {
  const hidden = view.hidden?.filter(([, ids]) => ids.length);
  const layers = view.layers?.root ? view.layers : undefined;
  return hidden?.length || layers ? JSON.stringify({ version: 1, hidden: hidden?.length ? hidden : undefined, layers }) : undefined;
}
