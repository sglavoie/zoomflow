import type { Board } from './index';
import { boundaryNeighbours } from './context';
import { boardLabel, boardTarget } from './lint-ast';
import type { BoundaryEvaluation, LintDiagnostic, LintOptions } from './lint-types';

/** Check reachability, return links and the boundary contracts of linked child layers. */
export function lintNavigation(boards: Map<string, Board>, links: Map<string, Set<string>>,
  boardRanges: Map<string, string>, options: LintOptions, diagnostics: LintDiagnostic[],
  shapeRange: (board: string, shape: string) => string | undefined): BoundaryEvaluation[] {
  const boundaries: BoundaryEvaluation[] = [];
  const owners = new Map<string, { board: Board; shape: string; child: Board }[]>();
  const label = (id: string) => boardLabel(id, boards);
  // Layers are reachable only by following links from root; like D2's own viewer,
  // a reachable board's scenarios and steps are reachable without a link.
  const reachable = new Set(['root']);
  for (const id of reachable) {
    const next = [...links.get(id) ?? []];
    for (const board of boards.values()) if (board.parent === id && board.kind !== 'layers') next.push(board.id);
    for (const target of next) reachable.add(target);
  }
  const linked = new Set([...links].flatMap(([source, targets]) => [...targets].filter((target) => target !== source)));
  for (const board of boards.values()) {
    if (board.kind === 'layers' && !reachable.has(board.id)) diagnostics.push({
      rule: 'orphan-board', severity: 'warning', board: board.id, range: boardRanges.get(board.id),
      message: linked.has(board.id) ? `Layer "${label(board.id)}" is linked only from boards unreachable from the root.`
        : `Layer "${label(board.id)}" has no incoming board link.`,
    });
    // Scenarios and steps are navigated without links, so only layers need a way back.
    if (options.missingBacklink && board.kind === 'layers' && board.parent && ![
      ...board.diagram.shapes, ...board.diagram.connections, board.diagram.root,
    ].some((item) => boardTarget(item.link, board, boards) === board.parent)) diagnostics.push({
      rule: 'missing-backlink', severity: 'warning', board: board.id, range: boardRanges.get(board.id),
      message: `Board "${label(board.id)}" has no link to its parent "${label(board.parent)}".`,
    });
    if (!options.boundaryPorts) continue;
    for (const shape of board.diagram.shapes) {
      const target = boardTarget(shape.link, board, boards);
      const child = target && boards.get(target);
      // Only immediate child layers represent a parent's drillable node.
      if (!child || child.kind !== 'layers' || child.parent !== board.id) continue;
      owners.set(child.id, [...owners.get(child.id) ?? [], { board, shape: shape.id, child }]);
    }
  }

  // Several parent nodes may drill into one layer; a port need only match one of them.
  for (const group of owners.values()) {
    const { board, child } = group[0];
    const ports = {
      in: child.diagram.shapes.filter((port) => port.classes?.includes('zf-in')),
      out: child.diagram.shapes.filter((port) => port.classes?.includes('zf-out')),
    };
    // Port-free layers use inferred parent connections; they have no explicit contract.
    if (!ports.in.length && !ports.out.length) continue;
    const requirements = group.map(({ shape }) => ({ shape, required: boundaryNeighbours(board.diagram, shape),
      evaluation: { board: board.id, shape, child: child.id, expected: 0, evaluated: 0 } as BoundaryEvaluation }));
    const names = requirements.map(({ shape }) => `"${shape}"`).join(' or ');
    for (const direction of ['in', 'out'] as const) {
      // Missing ports are per owner; a port is unmatched only if no owner needs it.
      for (const { shape, required, evaluation } of requirements) {
        evaluation.expected += required[direction].size;
        for (const neighbour of required[direction]) {
          // D2 IDs are case-insensitive within a board, so `API` and `api` name the same port.
          const matches = ports[direction].filter((port) => port.id.toLowerCase() === neighbour.toLowerCase());
          if (matches.length) evaluation.evaluated++;
          else diagnostics.push({ rule: `boundary-${direction}`, severity: 'error', board: board.id, shape,
            range: shapeRange(board.id, shape),
            message: `"${shape}" needs a zf-${direction} port named "${neighbour}" in "${label(child.id)}".` });
        }
      }
      for (const port of ports[direction]) {
        if (!requirements.some(({ required }) => [...required[direction]].some((id) => id.toLowerCase() === port.id.toLowerCase()))) diagnostics.push({
          rule: `boundary-${direction}`, severity: 'error', board: child.id, shape: port.id, range: shapeRange(child.id, port.id),
          message: `zf-${direction} port "${port.id}" has no matching ${direction === 'in' ? 'incoming' : 'outgoing'} neighbour of ${names} in "${label(board.id)}".`,
        });
      }
    }
    for (const { shape, required, evaluation } of requirements) {
      if (required.incident && evaluation.evaluated === 0) diagnostics.push({
        rule: required.out.size && !required.in.size ? 'boundary-out' : 'boundary-in',
        severity: 'error', board: board.id, shape, range: shapeRange(board.id, shape),
        message: `Zero boundary pairs evaluated for "${shape}" → "${label(child.id)}" despite incident edges. Add matching zf-in/zf-out ports and directed edges.`,
      });
      boundaries.push(evaluation);
    }
  }
  return boundaries;
}
