import type { Board } from './index';

/** Only labels and board ancestry are needed, including in an offline export. */
type SearchBoard = Pick<Board, 'id' | 'name' | 'parent'> & {
  diagram: { shapes: readonly { id: string; label?: string }[] };
};

/** A destination in a compiled document. Shape IDs are scoped to their board. */
export type DiagramSearchEntry = {
  board: string;
  trail: string[];
  breadcrumb: string;
  label: string;
  shape?: string;
};

/** Index a board tree without rendering its SVGs. */
export function indexDiagramSearch(boards: ReadonlyMap<string, SearchBoard>): DiagramSearchEntry[] {
  const entries: DiagramSearchEntry[] = [];
  for (const board of boards.values()) {
    const trail = [board.id];
    for (let parent = board.parent; parent; parent = boards.get(parent)?.parent) trail.unshift(parent);
    const breadcrumb = trail.map(id => boards.get(id)!.name).join(' › ');
    const destination = { board: board.id, trail, breadcrumb };
    entries.push({ ...destination, label: board.name });
    for (const shape of board.diagram.shapes) entries.push({ ...destination, label: ('label' in shape && shape.label) || shape.id, shape: shape.id });
  }
  return entries;
}

/** Literal, case-insensitive label matching. Empty queries wait for the user to type. */
export function searchDiagram<T extends DiagramSearchEntry>(entries: readonly T[], query: string): T[] {
  const text = query.trim().toLocaleLowerCase();
  return text ? entries.filter(entry => entry.label.toLocaleLowerCase().includes(text)) : [];
}
