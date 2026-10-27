import { D2 } from '@d2lang/d2';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { linkedFiles } from '../src/export-menu';
import { projectFileSystem } from '../src/project-files';

let d2: D2;
beforeAll(() => { d2 = new D2(); });
afterAll(async () => { await d2?.dispose(); });

it('exports the files that connection links open, as the CLI does', async () => {
  const fs = { 'other.d2': 'x', 'shape.d2': 'y', 'nested.d2': 'z' };
  const source = 'a -> b: Ships {link: ./other.d2}\nc: {link: ./shape.d2}\nlayers: {\n  L: {\n    d -> e: {link: "./nested.d2#/"}\n  }\n}\n';
  const { diagram } = await d2.compile(projectFileSystem('index.d2', fs, source));
  expect(linkedFiles(diagram, 'index.d2').sort()).toEqual(['nested.d2', 'other.d2', 'shape.d2']);
});
