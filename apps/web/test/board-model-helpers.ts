import { D2 } from '@d2lang/d2';
import { afterAll, beforeAll } from 'vitest';
import { boardBlocks, indexBoards } from '@zoomflow/core';
import { boardSites } from '../src/board-model';
import { flowSource, flowTemplate } from '../src/flow-model';
import { parseOutline, type MindMap } from '../src/mind-map-model';
import { plainLook } from '../src/flow-model';
import { projectFileSystem } from '../src/project-files';

let d2: D2;
beforeAll(() => { d2 = new D2(); });
afterAll(async () => { await d2?.dispose(); });

export const compile = (source: string) => d2.compile({ ...projectFileSystem('index.d2', {}, source), options: { layout: 'elk' } });
export async function sites(source: string) {
  const compiled = await compile(source);
  const boards = indexBoards(compiled.diagram);
  return { boards, sites: boardSites(source, boardBlocks(compiled.graph, source, compiled.inputPath), boards) };
}
export const flow = flowSource(flowTemplate('approval'));
export const map = (outline: string, split = 0): MindMap => ({ direction: 'right', split, look: plainLook(), root: parseOutline(outline)! });

