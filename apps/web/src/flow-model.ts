export type FlowStep = { id: string; label: string; shape: 'rectangle' | 'diamond' | 'oval' };
export type FlowConnection = { from: string; to: string; label: string };
export type Flow = { direction: 'down' | 'right'; steps: FlowStep[]; connections: FlowConnection[] };

const heading = '# Created with the Zoomflow flow builder.';
// D2 also interpolates dollar signs inside double-quoted strings.
const quote = (text: string) => JSON.stringify(text).replaceAll('$', '\\$');
const unquote = (text: string): string => JSON.parse(text.replaceAll('\\$', '$'));

export function flowTemplate(template: string): Flow {
  const approval = template === 'approval';
  const labels = approval ? ['Receive request', 'Approved?', 'Complete request', 'Request changes'] : ['Start', 'Do something', 'Done'];
  return {
    direction: 'down',
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

/** Fixed identifiers keep names, punctuation and duplicate labels out of D2 syntax. */
export function flowSource(flow: Flow): string {
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
  const direction = lines[1]?.match(/^direction: (down|right)$/)?.[1] as Flow['direction'] | undefined;
  if (!direction) return;
  const flow: Flow = { direction, steps: [], connections: [] };
  try {
    for (const line of lines.slice(2).filter(Boolean)) {
      const step = line.match(/^(step_\d+): ("(?:[^"\\]|\\.)*") \{shape: (rectangle|diamond|oval)\}$/);
      const edge = line.match(/^(step_\d+) -> (step_\d+): ("(?:[^"\\]|\\.)*")$/);
      if (step) flow.steps.push({ id: step[1], label: unquote(step[2]), shape: step[3] as FlowStep['shape'] });
      else if (edge) flow.connections.push({ from: edge[1], to: edge[2], label: unquote(edge[3]) });
      else return;
    }
  } catch { return; }
  const ids = new Set(flow.steps.map(step => step.id));
  if (!ids.size || ids.size !== flow.steps.length || flow.steps.some(step => !step.label.trim()) ||
    flow.connections.some(edge => !ids.has(edge.from) || !ids.has(edge.to))) return;
  return flowSource(flow).trim() === normalized ? flow : undefined;
}

export function flowFilename(title: string, fallback = 'My flow') {
  const name = title.trim().replace(/\.d2$/i, '').replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-').replace(/[. ]+$/, '').slice(0, 100);
  return `${name || fallback}.d2`;
}
