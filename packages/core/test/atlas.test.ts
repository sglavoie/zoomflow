import { describe, expect, it } from 'vitest';
import { atlasHash, classifyHref, parseAtlasHash, rebaseFileHref, resolveFilePath } from '../src/index';

describe('rebaseFileHref', () => {
  it.each([
    ['lib/part.d2', '../../other.d2'],
    ['lib/part.d2', './dist/other.d2'],
    ['lib/part.d2', './.hidden/other.d2'],
    ['lib/part.d2', './other.d2'],
    ['lib/part.d2', '../other.d2'],
    ['part.d2', '../../../other.d2'],
    ['work/deep/part.d2', '../other.d2'],
    ['work/deep/part.d2', './other.d2'],
    ['lib/part.d2', './a//other.d2'],
  ])('keeps the destination and project validity of %s linking %s', (from, path) => {
    const input = 'work/deep/index.d2';
    const rebased = classifyHref(rebaseFileHref(`${path}#/Q%20A`, from, input));
    expect(rebased.kind).toBe('file');
    if (rebased.kind !== 'file') return;
    expect(rebased.hash).toBe('#/Q%20A');
    for (const scanned of [false, true]) {
      expect(resolveFilePath(input, rebased.path, scanned)).toBe(resolveFilePath(from, path, scanned));
    }
  });
});

describe('resolveFilePath', () => {
  it.each([
    ['index.d2', './health.d2', 'health.d2'],
    ['index.d2', './work/plan.d2', 'work/plan.d2'],
    ['work/plan.d2', '../index.d2', 'index.d2'],
    ['work/plan.d2', './notes.d2', 'work/notes.d2'],
    ['a/b/c.d2', '../../x/./y.d2', 'x/y.d2'],
    ['a/b/c.d2', './../d.d2', 'a/d.d2'],
    ['index.d2', './My Life.d2', 'My Life.d2'],
    ['leben/übersicht.d2', './gesundheit/schlaf 😴.d2', 'leben/gesundheit/schlaf 😴.d2'],
  ])('from %s, %s is %s', (from, relative, path) => {
    expect(resolveFilePath(from, relative)).toBe(path);
  });
  it.each([
    ['index.d2', '../outside.d2'],
    ['work/plan.d2', '../../outside.d2'],
    ['a/b.d2', './../../c.d2'],
    ['index.d2', './.hidden/x.d2'],
    ['index.d2', './node_modules/x.d2'],
    ['index.d2', './dist/x.d2'],
    ['index.d2', './a//b.d2'],
    ['index.d2', './a\\b.d2'],
    ['index.d2', './a.txt'],
    ['index.d2', './C:/x.d2'],
  ])('from %s, %s is not a project file', (from, relative) => {
    expect(resolveFilePath(from, relative)).toBeUndefined();
  });
  it('opens hidden and build folders only when the web app\'s scan exclusions are off', () => {
    for (const relative of ['./.hidden/x.d2', './node_modules/x.d2', './dist/x.d2', './coverage/x.d2']) {
      expect(resolveFilePath('index.d2', relative)).toBeUndefined();
      expect(resolveFilePath('index.d2', relative, false)).toBe(relative.slice(2));
    }
    expect(resolveFilePath('dist/index.d2', './x.d2', false)).toBe('dist/x.d2');
    for (const relative of ['../outside.d2', './a//b.d2', './a.txt']) expect(resolveFilePath('index.d2', relative, false)).toBeUndefined();
  });
});

describe('atlas hashes', () => {
  it('prefixes a file route to the file\'s own board route', () => {
    expect(atlasHash('health.d2', '#/')).toBe('#/@file/health.d2');
    expect(atlasHash('health.d2', '#/Sleep')).toBe('#/@file/health.d2/Sleep');
    expect(atlasHash('work/My plan.d2', '#/A/@scenarios/B')).toBe('#/@file/work%2FMy%20plan.d2/A/@scenarios/B');
  });
  it.each([
    ['health.d2', '#/'], ['health.d2', '#/Sleep'], ['work/plan.d2', '#/A/@scenarios/B'],
    ['My Life.d2', '#/%40file/x'], ['leben/übersicht 😴.d2', '#/%C3%BC/@steps/1'], ['a#b?.d2', '#/a%2Fb'],
  ])('round-trips %s at %s', (path, hash) => {
    expect(parseAtlasHash(atlasHash(path, hash))).toEqual({ path, hash });
  });
  it('leaves entry-file routes to the entry file', () => {
    expect(parseAtlasHash('#/')).toEqual({ hash: '#/' });
    expect(parseAtlasHash('')).toEqual({ hash: '#/' });
    expect(parseAtlasHash('#/Sleep/@scenarios/Night')).toEqual({ hash: '#/Sleep/@scenarios/Night' });
    // A board literally named "@file" is percent-encoded, so it stays a board route.
    expect(parseAtlasHash('#/%40file/x')).toEqual({ hash: '#/%40file/x' });
  });
  it('keeps a malformed file segment raw', () => {
    expect(parseAtlasHash('#/@file/%E0%A4%A/Sleep')).toEqual({ path: '%E0%A4%A', hash: '#/Sleep' });
  });
});

/** Evaluate a function's source with no surrounding module scope, as the offline HTML does. */
function isolated<T>(fn: T): T {
  return new Function(`return (${String(fn)})`)() as T;
}

describe('serialized helpers', () => {
  it('work without module scope, as the offline viewer embeds them', () => {
    expect(isolated(resolveFilePath)('work/plan.d2', '../health.d2')).toBe('health.d2');
    expect(isolated(resolveFilePath)('index.d2', '../x.d2')).toBeUndefined();
    expect(isolated(parseAtlasHash)(isolated(atlasHash)('work/plan.d2', '#/A'))).toEqual({ path: 'work/plan.d2', hash: '#/A' });
  });
});
