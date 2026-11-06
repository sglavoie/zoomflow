// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { restoreField } from '../src/field-preference';

beforeEach(() => localStorage.clear());
afterEach(() => vi.restoreAllMocks());

it('restores exact edits before blur, including multiline text and intentionally cleared fields', () => {
  const field = document.createElement('textarea');
  restoreField(field, 'test');
  field.value = '  PATH=~/my directory\nEMPTY=\n';
  field.dispatchEvent(new Event('input'));
  const reloaded = document.createElement('textarea');
  restoreField(reloaded, 'test');
  expect(reloaded.value).toBe(field.value);
  reloaded.value = '';
  reloaded.dispatchEvent(new Event('input'));
  const cleared = document.createElement('textarea');
  cleared.value = 'default';
  restoreField(cleared, 'test');
  expect(cleared.value).toBe('');
});

it('ignores invalid saved choices and overlong text', () => {
  const select = document.createElement('select');
  select.innerHTML = '<option value="claude">Claude</option><option value="codex">Codex</option>';
  localStorage.setItem('provider', 'removed-provider');
  restoreField(select, 'provider');
  expect(select.value).toBe('claude');
  select.value = 'codex';
  select.dispatchEvent(new Event('change'));
  expect(localStorage.getItem('provider')).toBe('codex');
  const input = document.createElement('input');
  input.maxLength = 4;
  localStorage.setItem('text', 'too long');
  restoreField(input, 'text');
  expect(input.value).toBe('');
});

it('keeps fields usable when browser storage is blocked or full', () => {
  vi.spyOn(localStorage, 'getItem').mockImplementation(() => { throw new Error('Blocked'); });
  vi.spyOn(localStorage, 'setItem').mockImplementation(() => { throw new Error('Full'); });
  const field = document.createElement('input');
  field.value = 'initial';
  const save = restoreField(field, 'test');
  expect(field.value).toBe('initial');
  field.value = 'edited';
  expect(save).not.toThrow();
  expect(field.value).toBe('edited');
});
