import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readVersion } from './version.ts';

process.chdir(fileURLToPath(new URL('..', import.meta.url)));
const version = readVersion();
// Extract outside the checkout so missing dependencies cannot resolve through its node_modules.
const temp = mkdtempSync(join(tmpdir(), 'zoomflow-release-'));
try {
  execFileSync('tar', ['-xzf', resolve(`dist/release/zoomflow-cli-v${version}.tar.gz`), '-C', temp]);
  const cli = join(temp, `zoomflow-cli-v${version}/packages/cli/bin/zoomflow.mjs`);
  const run = (args: string[]) => execFileSync(process.execPath, [cli, ...args], { cwd: temp, encoding: 'utf8' });
  assert.equal(run(['--version']), `zoomflow ${version}\n`);
  const input = join(temp, 'flow.d2');
  writeFileSync(input, '...@zoomflow\na -> b');
  const result = JSON.parse(run(['lint', input, '--json']));
  assert.deepEqual(result.diagnostics, []);
  const output = join(temp, 'flow.html');
  run(['export', input, '--format', 'html', '-o', output]);
  assert.match(readFileSync(output, 'utf8'), /zoomflow-data/);
  console.log('Extracted CLI: version, WASM lint, bundled stdlib, native export and fonts passed.');
} finally { rmSync(temp, { recursive: true, force: true }); }
