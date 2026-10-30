import { readFileSync } from 'node:fs';

export const manifests = ['package.json', 'packages/core/package.json', 'packages/viewer/package.json',
  'packages/cli/package.json', 'apps/web/package.json'];

export function readVersion(): string {
  const packages = manifests.map((file) => JSON.parse(readFileSync(file, 'utf8')));
  const version = packages[0].version;
  if (typeof version !== 'string' || !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version)) {
    throw new Error('Expected a major.minor.patch version in package.json.');
  }
  if (packages.some((pkg) => pkg.version !== version || pkg.private !== true)) {
    throw new Error('All workspace packages must be private and have the same version.');
  }
  return version;
}

export function bumpVersion(version: string, bump: string): string {
  const parts = version.split('.').map(Number);
  const index = ['major', 'minor', 'patch'].indexOf(bump);
  if (index < 0 || parts.some((part) => !Number.isSafeInteger(part))) throw new Error('Invalid version or bump.');
  parts[index]++;
  for (let i = index + 1; i < parts.length; i++) parts[i] = 0;
  if (!Number.isSafeInteger(parts[index])) throw new Error('Version is too large.');
  return parts.join('.');
}
