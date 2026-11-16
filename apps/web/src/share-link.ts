/** Share URLs contain raw-deflated UTF-8 D2, encoded with the URL-safe base64 alphabet. */
export const shareLinkLimit = 8_000;

export async function encodeShareSource(source: string): Promise<string> {
  const stream = new Blob([source]).stream().pipeThrough(new CompressionStream('deflate-raw'));
  const bytes = new Uint8Array(await new Response(stream).arrayBuffer());
  return btoa(Array.from(bytes, byte => String.fromCharCode(byte)).join(''))
    .replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

export async function decodeShareSource(encoded: string): Promise<string> {
  if (!encoded || encoded.length > shareLinkLimit || !/^[A-Za-z0-9_-]+$/.test(encoded) || encoded.length % 4 === 1)
    throw new Error('Invalid share link.');
  const bytes = Uint8Array.from(atob(encoded.replaceAll('-', '+').replaceAll('_', '/')), char => char.charCodeAt(0));
  // Reject noncanonical base64 (unused trailing bits), too.
  const canonical = btoa(Array.from(bytes, byte => String.fromCharCode(byte)).join(''))
    .replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
  if (canonical !== encoded) throw new Error('Invalid share link.');
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new TextDecoder('utf-8', { fatal: true }).decode(await new Response(stream).arrayBuffer());
}

export function shareURL(encoded: string, appURL: string, hash: string): string {
  const url = new URL(appURL);
  url.searchParams.set('d', encoded);
  url.hash = hash || '#/';
  return url.href;
}
