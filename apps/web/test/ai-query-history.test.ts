// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { setupAiQueryHistory } from '../src/ai-query-history';
import { nameParts, paneScope } from '../src/pane-scope';

const key = 'zoomflow.ai-query-history.v1';
const controllers: ReturnType<typeof setupAiQueryHistory>[] = [];
function history() {
  const root = document.createElement('section');
  root.innerHTML = `<textarea></textarea><div id="ai-query-history" hidden>
    <select id="ai-previous-queries"></select><button id="ai-clear-history" type="button">Clear history</button></div>`;
  document.body.append(root);
  nameParts(root);
  const prompt = root.querySelector('textarea')!;
  const scope = paneScope('a', root);
  const api = setupAiQueryHistory(scope, prompt);
  controllers.push(api);
  return { api, prompt, row: scope.part('ai-query-history'), picker: scope.part<HTMLSelectElement>('ai-previous-queries'),
    clear: scope.part<HTMLButtonElement>('ai-clear-history') };
}
beforeEach(() => { localStorage.clear(); document.body.replaceChildren(); });
afterEach(() => { for (const api of controllers.splice(0)) api.dispose(); vi.restoreAllMocks(); });

it('saves recent distinct submissions across reloads and limits history to 50 queries', () => {
  const { api } = history();
  for (let i = 0; i < 55; i++) api.remember(`Query ${i}`);
  api.remember('  Query 10  ');
  api.remember('   ');
  const saved = JSON.parse(localStorage.getItem(key)!);
  expect(saved).toHaveLength(50);
  expect(saved.slice(0, 3)).toEqual(['Query 10', 'Query 54', 'Query 53']);
  expect(saved.filter((query: string) => query === 'Query 10')).toHaveLength(1);
  expect(saved).not.toContain('Query 0');
  const restored = history();
  expect(restored.row.hidden).toBe(false);
  expect([...restored.picker.options].slice(1).map(option => option.text)).toEqual(saved);
});

it('restores the full multiline query for editing without submitting and allows selecting it again', () => {
  const { api, prompt, picker } = history();
  const query = ('<script>alert("hello")</script>\n' + 'A long question '.repeat(30)).trim();
  api.remember(query);
  expect(picker.options[1]!.text.length).toBe(121);
  expect(picker.querySelector('script')).toBeNull();
  const submit = vi.fn();
  document.addEventListener('submit', submit, { once: true });
  for (let i = 0; i < 2; i++) {
    picker.value = '0';
    picker.dispatchEvent(new Event('change'));
    expect(prompt.value).toBe(query);
    expect(document.activeElement).toBe(prompt);
    expect(prompt.selectionStart).toBe(query.length);
    expect(picker.value).toBe('');
    prompt.value += ' Edited';
  }
  expect(submit).not.toHaveBeenCalled();
  document.removeEventListener('submit', submit);
});

it('synchronizes panes, merges their submissions, and clears history without changing a draft prompt', () => {
  const first = history(), second = history();
  first.api.remember('First question');
  expect(second.picker.options[1]!.text).toBe('First question');
  second.api.remember('Second question');
  expect(first.picker.options[1]!.text).toBe('Second question');
  first.prompt.value = 'Unsaved prompt';
  first.clear.click();
  expect(first.prompt.value).toBe('Unsaved prompt');
  expect(first.row.hidden).toBe(true);
  expect(second.row.hidden).toBe(true);
  expect(JSON.parse(localStorage.getItem(key)!)).toEqual([]);
});

it('ignores malformed data and invalid saved entries', () => {
  for (const value of ['{broken', '{}', 'null', JSON.stringify([null, 42, '', '  ', 'Valid', 'Valid', 'x'.repeat(8001)])]) {
    localStorage.setItem(key, value);
    const { picker } = history();
    expect([...picker.options].slice(1).map(option => option.text)).toEqual(value.startsWith('[') ? ['Valid'] : []);
  }
});

it('keeps query selection usable in memory when storage reads or writes fail', () => {
  const read = vi.spyOn(localStorage, 'getItem').mockImplementation(() => { throw new Error('Storage blocked'); });
  const write = vi.spyOn(localStorage, 'setItem').mockImplementation(() => { throw new Error('Storage full'); });
  const { api, picker, prompt } = history();
  expect(() => api.remember('Still ask this')).not.toThrow();
  picker.value = '0';
  picker.dispatchEvent(new Event('change'));
  expect(prompt.value).toBe('Still ask this');
  api.setDisabled(true);
  prompt.value = 'Request in progress';
  picker.value = '0';
  picker.dispatchEvent(new Event('change'));
  expect(prompt.value).toBe('Request in progress');
  read.mockRestore(); write.mockRestore();
});

it('refreshes changes from another tab and stops listening after disposal', () => {
  const { api, picker } = history();
  localStorage.setItem(key, JSON.stringify(['From another tab']));
  window.dispatchEvent(new StorageEvent('storage', { key, storageArea: localStorage }));
  expect(picker.options[1]!.text).toBe('From another tab');
  api.dispose();
  localStorage.clear();
  window.dispatchEvent(new StorageEvent('storage', { key: null, storageArea: localStorage }));
  expect(picker.options[1]!.text).toBe('From another tab');
});
