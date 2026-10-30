import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { bumpVersion, manifests } from '../version.ts';

const scripts = fileURLToPath(new URL('..', import.meta.url));
const temps: string[] = [];
afterEach(() => { for (const temp of temps.splice(0)) rmSync(temp, { recursive: true, force: true }); });

function setup() {
  const temp = mkdtempSync(join(tmpdir(), 'zoomflow-release-test-'));
  temps.push(temp);
  const cwd = join(temp, 'repo');
  const remote = join(temp, 'remote.git');
  const bin = join(temp, 'bin');
  mkdirSync(cwd); mkdirSync(bin);
  const git = (...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  git('init', '--bare', remote);
  git('init', '-b', 'main');
  git('config', 'user.name', 'Release Test');
  git('config', 'user.email', 'release@example.com');
  git('config', 'commit.gpgsign', 'false');
  git('config', 'tag.gpgsign', 'false');
  mkdirSync(join(cwd, 'scripts'));
  cpSync(join(scripts, 'release.ts'), join(cwd, 'scripts/release.ts'));
  cpSync(join(scripts, 'version.ts'), join(cwd, 'scripts/version.ts'));
  for (const file of manifests) {
    mkdirSync(dirname(join(cwd, file)), { recursive: true });
    writeFileSync(join(cwd, file), JSON.stringify({ name: file, version: '1.2.3', private: true }, null, 2) + '\n');
  }
  git('add', '.'); git('commit', '-m', 'Initial');
  git('remote', 'add', 'origin', remote);
  git('push', '-u', 'origin', 'main');
  writeFileSync(join(bin, 'gh'), `#!/usr/bin/env node
const fs = require('node:fs');
const args = process.argv.slice(2);
fs.appendFileSync(process.env.MOCK_LOG, JSON.stringify(args) + '\\n');
const url = 'https://github.com/example/zoomflow/releases/tag/v1.2.4';
if (args[0] === 'release' && args[1] === 'view') {
  if (!fs.existsSync(process.env.MOCK_RELEASE)) process.exit(1);
  console.log(args.includes('--jq') ? url : JSON.stringify({ isDraft: false, url }));
}
if (args[0] === 'run' && args[1] === 'list') console.log(JSON.stringify([
  { databaseId: 42, headBranch: 'v1.2.4', status: 'completed', conclusion: 'failure' }
]));
if (args[0] === 'run' && args[1] === 'watch') {
  if (process.env.MOCK_FAIL === '1') process.exit(1);
  fs.writeFileSync(process.env.MOCK_RELEASE, 'published');
}
`);
  chmodSync(join(bin, 'gh'), 0o755);
  const env = { ...process.env, PATH: `${bin}:${process.env.PATH}`, MOCK_LOG: join(temp, 'gh.log'), MOCK_RELEASE: join(temp, 'released') };
  const run = (args: string[], extra: NodeJS.ProcessEnv = {}) => spawnSync(process.execPath, ['scripts/release.ts', ...args],
    { cwd, encoding: 'utf8', env: { ...env, ...extra } });
  const calls = () => readFileSync(env.MOCK_LOG, 'utf8');
  return { cwd, remote, git, run, calls };
}

describe('release command', () => {
  it('bumps every private workspace package, commits, and pushes the annotated tag with main', () => {
    const ctx = setup();
    const result = ctx.run(['patch']);
    expect(result.status, result.stderr).toBe(0);
    for (const file of manifests) expect(JSON.parse(readFileSync(join(ctx.cwd, file), 'utf8'))).toMatchObject({ version: '1.2.4', private: true });
    expect(ctx.git('log', '-1', '--format=%s')).toBe('chore(release): v1.2.4');
    expect(ctx.git('cat-file', '-t', 'v1.2.4')).toBe('tag');
    expect(ctx.git('ls-remote', 'origin', 'refs/heads/main')).toContain(ctx.git('rev-parse', 'HEAD'));
    expect(ctx.git('ls-remote', 'origin', 'refs/tags/v1.2.4^{}')).toContain(ctx.git('rev-parse', 'HEAD'));
    expect(ctx.git('status', '--porcelain')).toBe('');
    expect(ctx.calls()).toContain('"watch","42","--exit-status"');
    expect(result.stdout).toContain('/releases/tag/v1.2.4');
  });

  it('dry-runs without changing versions, commits, tags or remote refs', () => {
    const ctx = setup(), before = ctx.git('rev-parse', 'HEAD');
    const result = ctx.run(['minor', '--dry-run']);
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain('Would release v1.3.0');
    expect(ctx.git('rev-parse', 'HEAD')).toBe(before);
    expect(ctx.git('status', '--porcelain')).toBe('');
    expect(ctx.git('tag', '--list')).toBe('');
    expect(ctx.git('ls-remote', '--tags', 'origin')).toBe('');
    expect(ctx.calls()).not.toContain('"run"');
  });

  it('refuses a dirty tree or a branch other than main before changing versions', () => {
    const ctx = setup();
    writeFileSync(join(ctx.cwd, 'untracked'), 'work');
    expect(ctx.run(['patch']).stderr).toContain('Commit or stash changes');
    rmSync(join(ctx.cwd, 'untracked'));
    ctx.git('switch', '-c', 'feature');
    expect(ctx.run(['patch']).stderr).toContain('Check out main');
    expect(ctx.git('tag', '--list')).toBe('');
  });

  it('rejects mismatched versions or non-private packages', () => {
    const ctx = setup();
    const file = join(ctx.cwd, 'packages/cli/package.json');
    writeFileSync(file, JSON.stringify({ version: '1.2.2', private: true }));
    expect(ctx.run(['patch']).stderr).toContain('same version');
    writeFileSync(file, JSON.stringify({ version: '1.2.3', private: false }));
    expect(ctx.run(['patch']).stderr).toContain('must be private');
  });

  it('rejects an existing tag and does not create a version commit', () => {
    const ctx = setup(), before = ctx.git('rev-parse', 'HEAD');
    ctx.git('tag', 'v1.2.4');
    expect(ctx.run(['patch']).stderr).toContain('v1.2.4 already exists');
    expect(ctx.git('rev-parse', 'HEAD')).toBe(before);
  });

  it('fetches origin and refuses a main behind or diverged from it', () => {
    const ctx = setup(), original = ctx.git('rev-parse', 'HEAD');
    ctx.git('commit', '--allow-empty', '-m', 'Remote advance');
    ctx.git('push', 'origin', 'main');
    const advanced = ctx.git('rev-parse', 'HEAD');
    ctx.git('reset', '--hard', original);
    // Make the tracking ref stale so the release must refresh it from the remote.
    ctx.git('update-ref', 'refs/remotes/origin/main', original);
    expect(ctx.run(['patch']).stderr).toContain('behind or has diverged');
    expect(ctx.git('rev-parse', 'origin/main')).toBe(advanced);
    expect(ctx.git('rev-parse', 'HEAD')).toBe(original);
    ctx.git('commit', '--allow-empty', '-m', 'Local advance');
    expect(ctx.run(['patch']).stderr).toContain('behind or has diverged');
    expect(ctx.git('tag', '--list')).toBe('');
  });

  it('resumes a failed workflow without another version bump and is a no-op after publication', () => {
    const ctx = setup();
    const failed = ctx.run(['patch'], { MOCK_FAIL: '1' });
    expect(failed.status).toBe(1);
    expect(failed.stderr).toContain('pnpm release resume');
    const commit = ctx.git('rev-parse', 'HEAD');
    const resumed = ctx.run(['resume']);
    expect(resumed.status, resumed.stderr).toBe(0);
    expect(ctx.git('rev-parse', 'HEAD')).toBe(commit);
    expect(ctx.calls()).toContain('"rerun","42","--failed"');
    const calls = ctx.calls();
    expect(ctx.run(['resume']).status).toBe(0);
    expect(ctx.calls().slice(calls.length)).not.toContain('"watch"');
  });

  it('does not resume an unrelated commit or a tag pointing at another commit', () => {
    const ctx = setup();
    expect(ctx.run(['resume']).stderr).toContain('release version commit at HEAD');
    ctx.git('tag', 'v1.2.3');
    ctx.git('commit', '--allow-empty', '-m', 'Unrelated work');
    expect(ctx.run(['resume']).stderr).toContain('original commit');
  });
});

it.each([['patch', '1.2.4'], ['minor', '1.3.0'], ['major', '2.0.0']])('calculates a %s version', (bump, next) => {
  expect(bumpVersion('1.2.3', bump)).toBe(next);
});
