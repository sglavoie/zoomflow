import type { CompileOptions } from '@d2lang/d2';
import regular from '../../../fonts/SourceSansPro-Regular.ttf?url';
import bold from '../../../fonts/SourceSansPro-Bold.ttf?url';
import italic from '../../../fonts/SourceSansPro-Italic.ttf?url';
import semibold from '../../../fonts/SourceSansPro-Semibold.ttf?url';

type FontOptions = Pick<CompileOptions, 'fontRegular' | 'fontBold' | 'fontItalic' | 'fontSemibold'>;

async function font(url: string): Promise<Uint8Array> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Could not load bundled font: HTTP ${response.status}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  // The pinned worker JSON.stringify's options. Go's []byte decoder accepts
  // base64, not the object produced by JSON.stringify(Uint8Array). Its published
  // CompileOptions type is incorrect; keep the compatibility cast here only.
  return btoa(binary) as unknown as Uint8Array;
}

let loaded: Promise<FontOptions> | undefined;
export function diagramFonts(): Promise<FontOptions> {
  return loaded ??= Promise.all([regular, bold, italic, semibold].map(font))
    .then(([fontRegular, fontBold, fontItalic, fontSemibold]) => ({ fontRegular, fontBold, fontItalic, fontSemibold }))
    .catch((error) => { loaded = undefined; throw error; });
}
