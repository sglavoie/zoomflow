import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { setTimeout } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { bumpVersion, manifests, readVersion } from './version.ts';

process.chdir(fileURLToPath(new URL('..', import.meta.url)));
const usage = 'Usage: pnpm release [patch|minor|major|resume] [--dry-run]\nDefaults to patch. resume retries the current version without another bump.';
const run = (command: string, args: string[]) => execFileSync(command, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] }).trim();
const git = (...args: string[]) => run('git', args);
const hasTag = (tag: string) => spawnSync('git', ['show-ref', '--verify', '--quiet', `refs/tags/${tag}`]).status === 0;
let started = false;

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 1 && ['--help', '-h'].includes(args[0])) { console.log(usage); return; }
  const dryRun = args.includes('--dry-run');
  const positional = args.filter((arg) => arg !== '--dry-run');
  const bump = positional[0] ?? 'patch';
  if (positional.length > 1 || !['patch', 'minor', 'major', 'resume'].includes(bump)) throw new Error(usage);
  const current = readVersion();
  const version = bump === 'resume' ? current : bumpVersion(current, bump);
  const tag = `v${version}`;
  if (git('status', '--porcelain')) throw new Error('Commit or stash changes before releasing.');
  if (git('branch', '--show-current') !== 'main') throw new Error('Check out main before releasing.');
  run('gh', ['auth', 'status']);
  git('fetch', 'origin', 'main', '--tags');
  if (spawnSync('git', ['merge-base', '--is-ancestor', 'origin/main', 'HEAD']).status !== 0) {
    throw new Error('Local main is behind or has diverged from origin/main; reconcile it before releasing.');
  }
  const head = git('rev-parse', 'HEAD');
  if (hasTag(tag) && (bump !== 'resume' || git('rev-parse', `${tag}^{commit}`) !== head)) {
    throw new Error(`${tag} already exists; resume requires its original commit checked out on main.`);
  }
  if (bump === 'resume' && !hasTag(tag) && git('log', '-1', '--format=%s') !== `chore(release): ${tag}`) {
    throw new Error('resume requires the release version commit at HEAD.');
  }
  console.log(`${dryRun ? 'Would release' : 'Releasing'} ${tag}${bump === 'resume' ? ' (resume)' : ` (${current} → ${version})`}.`);
  if (dryRun) {
    console.log('Bump workspace versions, commit, tag, and atomically push main and the tag to origin.\nGitHub Actions builds the CLI and web archives and publishes a GitHub Release. No npm publishing.');
    return;
  }
  if (bump !== 'resume') {
    started = true;
    for (const file of manifests) {
      const pkg = JSON.parse(readFileSync(file, 'utf8'));
      pkg.version = version;
      writeFileSync(file, JSON.stringify(pkg, null, 2) + '\n');
    }
    git('add', '--', ...manifests);
    git('commit', '-m', `chore(release): ${tag}`);
  }
  started = true;
  if (git('status', '--porcelain')) throw new Error('Source changed during release preparation.');
  if (!hasTag(tag)) git('tag', '-a', tag, '-m', tag);
  git('push', '--atomic', 'origin', 'HEAD:refs/heads/main', `refs/tags/${tag}`);

  // A successful previous run makes resume a no-op. Drafts still need their upload/publish job.
  const existing = spawnSync('gh', ['release', 'view', tag, '--json', 'isDraft,url'], { encoding: 'utf8' });
  if (existing.status === 0) {
    const release = JSON.parse(existing.stdout);
    if (!release.isDraft) { console.log(release.url); return; }
  }
  console.log(`Waiting for the Release workflow for ${tag}…`);
  const commit = git('rev-parse', 'HEAD');
  for (let attempt = 0; attempt < 60; attempt++) {
    const runs: { databaseId: number; headBranch: string; status: string; conclusion: string }[] = JSON.parse(run('gh',
      ['run', 'list', '--workflow', 'release.yml', '--commit', commit, '--event', 'push', '--limit', '20',
        '--json', 'databaseId,headBranch,status,conclusion']));
    const workflow = runs.find((item) => item.headBranch === tag);
    if (workflow) {
      if (bump === 'resume' && workflow.status === 'completed' && workflow.conclusion !== 'success') {
        run('gh', ['run', 'rerun', String(workflow.databaseId), '--failed']);
      }
      // gh run watch streams progress and exits nonzero if a build or publish step fails.
      execFileSync('gh', ['run', 'watch', String(workflow.databaseId), '--exit-status'], { stdio: 'inherit' });
      console.log(run('gh', ['release', 'view', tag, '--json', 'url', '--jq', '.url']));
      return;
    }
    await setTimeout(5000);
  }
  throw new Error('No Release workflow appeared within five minutes. Check GitHub Actions.');
}

try { await main(); }
catch (error) {
  console.error(error instanceof Error ? error.message : error);
  if (started) console.error('Release interrupted; keep the version commit and tag. Fix the failure, then run pnpm release resume.\nIf committing failed, commit the version files first with message: chore(release): vX.Y.Z (using the version printed above).');
  process.exitCode = 1;
}
