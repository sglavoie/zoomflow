import { deflateRawSync } from 'node:zlib';
import { expect, it } from 'vitest';
import { decodeShareSource, encodeShareSource, shareURL } from '../src/share-link';

it.each(['', 'a -> b', 'café: 日本語 🚀\ncafé -> résumé: Привет'])('round trips UTF-8 source %j', async source => {
  const encoded = await encodeShareSource(source);
  expect(encoded).toMatch(/^[A-Za-z0-9_-]+$/);
  expect(await decodeShareSource(encoded)).toBe(source);
});

it('rejects malformed, truncated, trailing and non-UTF-8 data', async () => {
  const encoded = await encodeShareSource('a -> b: 日本語');
  for (const bad of ['', '%', 'a', '====', 'not-a-deflate-stream', encoded.slice(0, -2), `${encoded}AAAA`,
    deflateRawSync(Buffer.from([0xff])).toString('base64url')]) {
    await expect(decodeShareSource(bad), bad).rejects.toThrow();
  }
});

it('keeps the app path and other query parameters while setting source and board', () => {
  expect(shareURL('abc', 'https://example.com/app/?pad=20&d=old#/old', '#/checkout'))
    .toBe('https://example.com/app/?pad=20&d=abc#/checkout');
});
