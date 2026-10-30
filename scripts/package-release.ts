import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, cpSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readVersion } from './version.ts';

process.chdir(fileURLToPath(new URL('..', import.meta.url)));
const version = readVersion();
if (process.env.GITHUB_REF_TYPE === 'tag' && process.env.GITHUB_REF_NAME !== `v${version}`) {
  throw new Error(`Release tag must match package.json: v${version}`);
}
for (const args of [['--filter', '@zoomflow/cli', 'build'], ['build']]) {
  execFileSync('pnpm', args, { stdio: 'inherit' });
}

const out = resolve('dist/release');
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
const d2 = realpathSync('packages/cli/node_modules/@d2lang/d2');
const copy = (source: string, target: string) => {
  mkdirSync(resolve(target, '..'), { recursive: true });
  cpSync(source, target, { recursive: true, dereference: true });
};

// Include the license texts of bundled dependencies, without machine-local paths.
const licenses: Record<string, { name: string; versions: string[]; paths: string[] }[]> = JSON.parse(
  execFileSync('pnpm', ['licenses', 'list', '--prod', '--json'], { encoding: 'utf8' }));
let notices = '# Bundled dependency notices\n';
for (const [license, packages] of Object.entries(licenses)) {
  for (const pkg of packages) {
    notices += `\n## ${pkg.name} ${pkg.versions.join(', ')} (${license})\n`;
    for (const file of readdirSync(pkg.paths[0]).filter((name) => /license|notice/i.test(name))) {
      notices += `\n### ${file}\n\n${readFileSync(join(pkg.paths[0], file), 'utf8')}\n`;
    }
  }
}

const archives: string[] = [];
for (const kind of ['cli', 'web']) {
  const name = `zoomflow-${kind}-v${version}`;
  const stage = join(out, name);
  mkdirSync(stage);
  for (const file of ['LICENSE', 'README.md', 'docs/cli.md', 'docs/releases.md', 'fonts/LICENSE.txt', 'vendor/d2/README.md']) {
    copy(file, join(stage, file));
  }
  writeFileSync(join(stage, 'THIRD_PARTY_NOTICES.md'), notices);
  if (kind === 'cli') {
    for (const file of ['packages/cli/dist', 'packages/cli/bin', 'packages/cli/package.json', 'fonts', 'stdlib']) {
      copy(file, join(stage, file));
    }
    copy(d2, join(stage, 'node_modules/@d2lang/d2'));
    chmodSync(join(stage, 'packages/cli/bin/zoomflow.mjs'), 0o755);
    writeFileSync(join(stage, 'package.json'), JSON.stringify({ private: true, type: 'module', version }, null, 2) + '\n');
  } else {
    copy('apps/web/dist', stage);
    // Keep the modified compiler's provenance and source patch with the browser build too.
    for (const file of readdirSync(d2).filter((name) => /license|notice|goldmark|zoomflow/i.test(name))) {
      copy(join(d2, file), join(stage, 'vendor/d2', file));
    }
  }
  const archive = `${name}.tar.gz`;
  execFileSync('tar', ['-czf', join(out, archive), '-C', out, name], { stdio: 'inherit' });
  archives.push(archive);
  rmSync(stage, { recursive: true });
}
writeFileSync(join(out, 'SHA256SUMS'), archives.map((file) =>
  `${createHash('sha256').update(readFileSync(join(out, file))).digest('hex')}  ${file}\n`).join(''));
console.log(`Release archives: ${out}`);
