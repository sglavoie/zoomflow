export type FlowStep = { id: string; label: string; shape: 'rectangle' | 'diamond' | 'oval' };
export type FlowConnection = { from: string; to: string; label: string };
/** Optional library looks, written in this order as `zf-<name>` classes after each shape's role. */
export const lookNames = ['filled', 'compact', 'shadow'] as const;
export type Look = Record<(typeof lookNames)[number], boolean>;
export const plainLook = (): Look => ({ filled: false, compact: false, shadow: false });
export type Flow = { direction: 'down' | 'right'; look: Look; steps: FlowStep[]; connections: FlowConnection[] };

const heading = '# Created with the Zoomflow flow builder.';
/** Steps use library classes, so restyling those classes restyles every flow. */
const library = '...@zoomflow';
const roles: Record<FlowStep['shape'], string> = { rectangle: 'zf-step', diamond: 'zf-decision', oval: 'zf-terminal' };
const shapes = Object.fromEntries(Object.entries(roles).map(([shape, role]) => [role, shape])) as Record<string, FlowStep['shape']>;

/** A label without the control characters `quote` cannot write; tabs and line breaks stay. Check labels after this,
 * or one made only of control characters passes as named and is written empty. */
export const cleanLabel = (text: string) => text.replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '');
/** A D2 double-quoted string. D2 also interpolates dollar signs inside them, and does not decode the `\u` escapes
 * JSON writes for control characters, so those are dropped; tabs and line breaks keep their escapes. */
export const quote = (text: string) => JSON.stringify(cleanLabel(text)).replaceAll('$', '\\$');
export const unquote = (text: string): string => JSON.parse(text.replaceAll('\\$', '$'));

/** A shape's classes: its role first, then the looks that override it. */
export function lookClasses(classes: string[], look: Look): string {
  const all = [...classes, ...lookNames.filter(name => look[name]).map(name => `zf-${name}`)];
  return all.length === 1 ? all[0] : `[${all.join('; ')}]`;
}
/** The look of a class value `lookClasses` wrote, with the classes before it. */
export function readLook(value: string): { classes: string[]; look: Look } | undefined {
  const classes = (/^\[(.*)\]$/.exec(value)?.[1].split('; ') ?? [value]);
  const look = plainLook();
  for (const name of [...lookNames].reverse()) if (classes.at(-1) === `zf-${name}`) { classes.pop(); look[name] = true; }
  if (lookClasses(classes, look) !== value) return;
  return { classes, look };
}

export function flowTemplate(template: string): Flow {
  const approval = template === 'approval';
  const labels = approval ? ['Receive request', 'Approved?', 'Complete request', 'Request changes'] : ['Start', 'Do something', 'Done'];
  return {
    direction: 'down',
    look: plainLook(),
    steps: labels.map((label, i) => ({ id: `step_${i + 1}`, label,
      shape: approval && i === 1 ? 'diamond' : i === 0 || i === 2 ? 'oval' : 'rectangle' })),
    connections: approval ? [
      { from: 'step_1', to: 'step_2', label: '' },
      { from: 'step_2', to: 'step_3', label: 'Yes' },
      { from: 'step_2', to: 'step_4', label: 'No' },
      { from: 'step_4', to: 'step_2', label: 'Try again' },
    ] : [{ from: 'step_1', to: 'step_2', label: '' }, { from: 'step_2', to: 'step_3', label: '' }],
  };
}

/** Lines labelled Yes or No take the library's branch colours. */
function connectionLine(edge: FlowConnection) {
  const branch = /^(yes|no)$/i.exec(cleanLabel(edge.label).trim())?.[1].toLowerCase();
  return `${edge.from} -> ${edge.to}: ${quote(edge.label)}${branch ? ` {class: zf-${branch}}` : ''}`;
}

/** Fixed identifiers keep names, punctuation and duplicate labels out of D2 syntax. */
export function flowSource(flow: Flow): string {
  return [heading, library, `direction: ${flow.direction}`, '',
    ...flow.steps.map(step => `${step.id}: ${quote(step.label)} {class: ${lookClasses([roles[step.shape]], flow.look)}}`), '',
    ...flow.connections.map(connectionLine), '',
  ].join('\n');
}

/** Flows from before the library classes set each step's shape directly. */
function legacyFlowSource(flow: Flow): string {
  return [heading, `direction: ${flow.direction}`, '',
    ...flow.steps.map(step => `${step.id}: ${quote(step.label)} {shape: ${step.shape}}`), '',
    ...flow.connections.map(edge => `${edge.from} -> ${edge.to}: ${quote(edge.label)}`), '',
  ].join('\n');
}

/** Only reopen the builder's complete, losslessly understood subset of D2.
 * Custom source must never be silently discarded when a form is saved. */
export function readFlow(source: string): Flow | undefined {
  const normalized = source.replaceAll('\r\n', '\n').trim();
  if (!normalized.startsWith(`${heading}\n`)) return;
  const lines = normalized.split('\n');
  const legacy = lines[1] !== library;
  const direction = lines[legacy ? 1 : 2]?.match(/^direction: (down|right)$/)?.[1] as Flow['direction'] | undefined;
  if (!direction) return;
  const flow: Flow = { direction, look: plainLook(), steps: [], connections: [] };
  try {
    for (const line of lines.slice(legacy ? 2 : 3).filter(Boolean)) {
      const step = line.match(/^(step_\d+): ("(?:[^"\\]|\\.)*") \{(shape|class): ([\w-]+|\[[\w; -]+\])\}$/);
      const edge = line.match(/^(step_\d+) -> (step_\d+): ("(?:[^"\\]|\\.)*")(?: \{class: zf-(?:yes|no)\})?$/);
      if (step) {
        const styled = step[3] === 'class' ? readLook(step[4]) : undefined;
        const name = styled ? styled.classes[0] : step[4];
        const shape = styled ? Object.hasOwn(shapes, name) && shapes[name] : Object.hasOwn(roles, name) && name as FlowStep['shape'];
        if (!shape) return;
        if (styled) flow.look = styled.look;
        flow.steps.push({ id: step[1], label: unquote(step[2]), shape });
      } else if (edge) flow.connections.push({ from: edge[1], to: edge[2], label: unquote(edge[3]) });
      else return;
    }
  } catch { return; }
  const ids = new Set(flow.steps.map(step => step.id));
  if (!ids.size || ids.size !== flow.steps.length || flow.steps.some(step => !step.label.trim()) ||
    flow.connections.some(edge => !ids.has(edge.from) || !ids.has(edge.to))) return;
  return (legacy ? legacyFlowSource(flow) : flowSource(flow)).trim() === normalized ? flow : undefined;
}

export function flowFilename(title: string, fallback = 'My flow') {
  const name = title.trim().replace(/\.d2$/i, '').replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-').replace(/[. ]+$/, '').slice(0, 100);
  return `${name || fallback}.d2`;
}
