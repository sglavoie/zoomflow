import { expect, it } from 'vitest';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { exportProjectArchive, readProjectArchive, projectArchiveLimit, type ProjectArchive } from '../src/project-archive';

const project: ProjectArchive = { name: 'Launch 日本語', entry: 'plans/Detail.d2', files: [
  { path: 'index.d2', source: 'Next: {link: ./plans/Detail.d2}\n' },
  { path: 'plans/Detail.d2', source: 'Secret: Private\nPublic: Keep\n', view: '{"version":1,"hidden":[["root",["Secret"]]],"layers":{"root":"root","all":false,"expanded":[],"depth":1}}' },
  { path: 'unused.d2', source: 'broken: {\n' },
] };

it('round-trips every editable file, relative path, entry and serialized view without compiling or hiding source', () => {
  const bytes = exportProjectArchive(project);
  expect(readProjectArchive(bytes)).toEqual(project);
  const files = unzipSync(bytes);
  expect(Object.keys(files)).toEqual(['zoomflow.json', 'sources/index.d2', 'sources/plans/Detail.d2', 'sources/unused.d2']);
  expect(strFromU8(files['sources/plans/Detail.d2'])).toContain('Secret: Private');
  expect(JSON.parse(strFromU8(files['zoomflow.json']))).toMatchObject({ version: 1, format: 'zoomflow-project', entry: project.entry });
});

function changed(change: (files: Record<string, Uint8Array>, manifest: any) => void) {
  const files = unzipSync(exportProjectArchive(project));
  const manifest = JSON.parse(strFromU8(files['zoomflow.json']));
  change(files, manifest);
  files['zoomflow.json'] = strToU8(JSON.stringify(manifest));
  return zipSync(files);
}

it('normalizes source line breaks and leaves damaged view settings recoverable independently', () => {
  const imported = readProjectArchive(changed((files, manifest) => {
    files['sources/index.d2'] = strToU8('a -> b\r\nb -> c\r');
    manifest.files[0].view = '{damaged';
    manifest.files[1].view = { invalid: true };
  }));
  expect(imported.files[0]).toEqual({ path: 'index.d2', source: 'a -> b\nb -> c\n', view: '{damaged' });
  expect(imported.files[1].view).toBeUndefined();
});

it.each([
  ['future version', (_files: any, manifest: any) => { manifest.version = 99; }, /version is not supported/],
  ['foreign manifest', (_files: any, manifest: any) => { manifest.format = 'something-else'; }, /not a Zoomflow project/],
  ['missing entry', (_files: any, manifest: any) => { manifest.entry = 'missing.d2'; }, /entry file is missing/],
  ['empty project', (_files: any, manifest: any) => { manifest.files = []; }, /between 1/],
  ['missing source', (files: any) => { delete files['sources/index.d2']; }, /Missing D2 source/],
  ['duplicate path', (_files: any, manifest: any) => { manifest.files.push(manifest.files[0]); }, /duplicate source path/],
  ['traversal', (files: any, manifest: any) => { manifest.files[0].path = '../escape.d2'; files['sources/../escape.d2'] = strToU8('a'); }, /source path/],
  ['absolute path', (_files: any, manifest: any) => { manifest.files[0].path = '/escape.d2'; }, /source path/],
  ['backslash path', (_files: any, manifest: any) => { manifest.files[0].path = 'folder\\escape.d2'; }, /source path/],
  ['invalid name', (_files: any, manifest: any) => { manifest.name = '../project'; }, /name without folder separators/],
] as const)('rejects %s before returning a partial project', (_label, change, message) => {
  expect(() => readProjectArchive(changed(change))).toThrow(message);
});

it('rejects ordinary ZIPs, damaged ZIPs, malformed manifests and oversized inflated content', () => {
  expect(() => readProjectArchive(zipSync({ 'index.d2': strToU8('a') }))).toThrow(/zoomflow.json is missing/);
  expect(() => readProjectArchive(strToU8('not a ZIP'))).toThrow(/Could not read project ZIP/);
  expect(() => readProjectArchive(zipSync({ 'zoomflow.json': strToU8('{bad') }))).toThrow(/not valid JSON/);
  const oversized = changed(files => { files['sources/index.d2'] = new Uint8Array(projectArchiveLimit + 1); });
  expect(() => readProjectArchive(oversized)).toThrow(/64 MiB/);
});

it('does not generate an archive that its reader would reject', () => {
  expect(() => exportProjectArchive({ ...project, entry: 'absent.d2' })).toThrow(/entry file is missing/);
  expect(() => exportProjectArchive({ ...project, files: [...project.files, project.files[0]] })).toThrow(/duplicate/);
});
