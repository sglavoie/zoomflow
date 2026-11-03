import type { PaneScope } from './pane-scope';

const STORAGE_KEY = 'zoomflow.ai-query-history.v1';
const HISTORY_CHANGED = 'zoomflow:ai-query-history-changed';
const MAX_QUERIES = 50;
const MAX_QUERY_LENGTH = 8000;

function readHistory(): string[] {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]');
    if (!Array.isArray(saved)) return [];
    return [...new Set(saved.filter((value): value is string => typeof value === 'string'
      && value.length <= MAX_QUERY_LENGTH).map(value => value.trim()).filter(Boolean))].slice(0, MAX_QUERIES);
  } catch { return []; }
}

/** Shared across diagrams and panes; selecting a query only fills the editable prompt. */
export function setupAiQueryHistory({ part }: Pick<PaneScope, 'part'>, prompt: HTMLTextAreaElement) {
  const row = part<HTMLElement>('ai-query-history');
  const picker = part<HTMLSelectElement>('ai-previous-queries');
  const clear = part<HTMLButtonElement>('ai-clear-history');
  let queries = readHistory();
  function option(label: string, value: string) {
    const node = document.createElement('option');
    node.textContent = label;
    node.value = value;
    return node;
  }
  function render() {
    picker.replaceChildren(option('Previous queries…', ''));
    queries.forEach((query, index) => {
      const label = query.replace(/\s+/g, ' ');
      const node = option(label.length > 120 ? `${label.slice(0, 120)}…` : label, String(index));
      node.title = query;
      picker.append(node);
    });
    row.hidden = queries.length === 0;
  }
  function save() {
    render();
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(queries));
      window.dispatchEvent(new Event(HISTORY_CHANGED));
    } catch { /* History remains usable in this pane when browser storage is unavailable. */ }
  }
  function refresh() { queries = readHistory(); render(); }
  function storageChanged(event: StorageEvent) {
    if (event.storageArea === localStorage && (event.key === STORAGE_KEY || event.key === null)) refresh();
  }
  function selectQuery() {
    if (picker.disabled || picker.value === '') return;
    const query = queries[Number(picker.value)];
    if (query === undefined) return;
    prompt.value = query;
    picker.value = '';
    prompt.focus();
    prompt.setSelectionRange(query.length, query.length);
  }
  function clearHistory() { queries = []; save(); prompt.focus(); }
  picker.addEventListener('change', selectQuery);
  clear.addEventListener('click', clearHistory);
  window.addEventListener(HISTORY_CHANGED, refresh);
  window.addEventListener('storage', storageChanged);
  picker.disabled = prompt.disabled;
  render();
  return {
    remember(value: string) {
      const query = value.trim();
      if (!query || query.length > MAX_QUERY_LENGTH) return;
      queries = [query, ...new Set([...readHistory(), ...queries].filter(previous => previous !== query))].slice(0, MAX_QUERIES);
      save();
    },
    setDisabled(disabled: boolean) { picker.disabled = disabled; },
    dispose() {
      picker.removeEventListener('change', selectQuery);
      clear.removeEventListener('click', clearHistory);
      window.removeEventListener(HISTORY_CHANGED, refresh);
      window.removeEventListener('storage', storageChanged);
    },
  };
}
