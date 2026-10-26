/** Find the classes a D2 file defines without a parser, so lint can tell an undefined class from an
 * imported one. Only the forms that define classes are followed: `classes: {name: ...}`,
 * `classes.name...` and spread imports at the top level, and `...@file.classes` inside `classes`.
 * Anything else that could define a class, such as `classes: @file`, makes the result unknown.
 */

type Scope = { kind: 'root' | 'classes' | 'other'; key: string; value: string; colon: boolean; done: boolean; brackets: number };

/** Split `a."b.c".d` into its unquoted segments. */
function keyPath(key: string): string[] {
  const segments: string[] = [];
  for (const [, double, single, plain] of key.matchAll(/\s*(?:"((?:[^"\\]|\\.)*)"|'([^']*)'|([^."']+))\s*\.?/g)) {
    segments.push(double?.replace(/\\(.)/g, '$1') ?? single ?? plain.trim());
  }
  return segments;
}

/** D2 resolves an import relative to its importing file and adds the `.d2` extension. */
function importTarget(from: string, spec: string): { path: string; within: string[] } {
  const [, up, rest] = /^((?:\.\.?\/)*)(.*)$/s.exec(spec.trim())!;
  const within = keyPath(rest);
  const file = within.shift() ?? '';
  if (within[0] === 'd2') within.shift();
  const parts = from.split('/').slice(0, -1);
  for (const part of `${up}${file}.d2`.split('/')) {
    if (part === '..') parts.pop();
    else if (part !== '.' && part) parts.push(part);
  }
  return { path: parts.join('/'), within };
}

/** Class names defined at the top level of `path`, or undefined when they cannot be known. */
export function definedClasses(files: Record<string, string>, path: string, seen = new Set<string>()): Set<string> | undefined {
  const text = files[path];
  if (typeof text !== 'string') return;
  const names = new Set<string>();
  if (seen.has(path)) return names;
  seen.add(path);
  let known = true;
  const follow = (file: string) => {
    const found = definedClasses(files, file, seen);
    found?.forEach((name) => names.add(name));
    return !!found;
  };
  const scope = (kind: Scope['kind']): Scope => ({ kind, key: '', value: '', colon: false, done: false, brackets: 0 });
  const stack = [scope('root')];
  /** A statement ends; `opens` is set when its value is a map. */
  const finish = (current: Scope, opens?: boolean): Scope['kind'] => {
    const key = current.key.trim();
    const value = current.value.trim();
    let inner: Scope['kind'] = 'other';
    if (current.done || !key) return inner;
    current.done = true;
    if (key.startsWith('...@')) {
      // A whole file spread at the top, or its `classes` spread into `classes`, adds its classes.
      // Spreading part of a file at the top adds shapes, not classes.
      const target = importTarget(path, key.slice(4));
      const part = target.within.join('.');
      if ((current.kind === 'root' && !part) || (current.kind === 'classes' && part === 'classes')) known &&= follow(target.path);
      else if (current.kind === 'classes') known = false;
      return inner;
    }
    const segments = keyPath(key);
    if (current.kind === 'root' && segments[0] === 'classes') {
      if (segments.length > 1) names.add(segments[1]);
      else if (opens) inner = 'classes';
      else if (value.startsWith('@')) known = false;
    } else if (current.kind === 'classes' && segments.length) names.add(segments[0]);
    return inner;
  };
  for (let i = 0; i < text.length; i++) {
    const current = stack.at(-1)!;
    const char = text[i];
    const append = (piece: string) => { if (current.colon) current.value += piece; else current.key += piece; };
    if (text.startsWith('"""', i)) {
      const end = text.indexOf('"""', i + 3);
      i = end < 0 ? text.length : end + 2;
    } else if (char === '#') {
      const end = text.indexOf('\n', i);
      i = (end < 0 ? text.length : end) - 1;
    } else if (text.startsWith('${', i)) {
      // A substitution's braces are not a map.
      const end = text.indexOf('}', i);
      append(text.slice(i, end < 0 ? text.length : end + 1));
      i = end < 0 ? text.length : end;
    } else if (char === '"' || char === "'") {
      let end = i + 1;
      while (end < text.length && text[end] !== char && text[end] !== '\n') end += char === '"' && text[end] === '\\' ? 2 : 1;
      append(text.slice(i, end + 1));
      i = end;
    } else if (char === '|' && current.colon) {
      // Block strings close with the same run of pipes that opened them.
      const pipes = /^\|+/.exec(text.slice(i))![0];
      const end = text.indexOf(pipes, text.indexOf('\n', i));
      if (end < 0) return;
      i = end + pipes.length - 1;
    } else if (char === '[') {
      current.brackets++;
      append(char);
    } else if (char === ']') {
      current.brackets--;
      append(char);
    } else if (current.brackets > 0) {
      append(char);
    } else if (char === '{') {
      stack.push(scope(finish(current, true)));
    } else if (char === '}') {
      finish(current);
      if (stack.length > 1) stack.pop();
      Object.assign(stack.at(-1)!, scope(stack.at(-1)!.kind));
    } else if (char === '\n' || char === ';') {
      finish(current);
      Object.assign(current, scope(current.kind));
    } else if (char === ':' && !current.colon) {
      current.colon = true;
    } else append(char);
  }
  finish(stack.at(-1)!);
  return known ? names : undefined;
}
