import { D2 } from '@d2lang/d2';
import { readFileSync } from 'node:fs';
import { afterAll } from 'vitest';
import { lint } from '../src';

export const d2 = new D2();

afterAll(() => d2.dispose());

export const library = readFileSync('stdlib/zoomflow.d2', 'utf8');

export const fixture = (name: string) => readFileSync(`fixtures/lint/${name}.d2`, 'utf8');

export const compile = (source: string) => d2.compile({ fs: { index: source, 'zoomflow.d2': library,
  'nodes.d2': fixture('nodes') }, options: { layout: 'elk' } });

export const strictLint = (compiled: Awaited<ReturnType<typeof compile>>) => lint(compiled, { boundaryPorts: true });
