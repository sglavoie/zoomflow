// @vitest-environment happy-dom
import { expect, it } from 'vitest';
import { isSaveKey } from '../src/shortcuts';

it('saves with the S key by letter, or by place only on layouts whose S key types no Latin letter', () => {
  const press = (key: string, code: string) => isSaveKey(new KeyboardEvent('keydown', { key, code, metaKey: true }));
  expect(press('s', 'KeyS')).toBe(true);
  expect(press('S', 'KeyS')).toBe(true);
  // Dvorak types S on another key.
  expect(press('s', 'Semicolon')).toBe(true);
  // Cyrillic types ы on the S key.
  expect(press('ы', 'KeyS')).toBe(true);
  // Colemak's R and Dvorak's O sit on the S key; ⌘R and ⌘O keep their own meaning.
  expect(press('r', 'KeyS')).toBe(false);
  expect(press('o', 'KeyS')).toBe(false);
});
