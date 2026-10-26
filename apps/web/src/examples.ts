import order from '../../../fixtures/order.d2?raw';
import mixed from './examples/mixed.d2?raw';
import flowchart from './examples/flowchart.d2?raw';
import architecture from './examples/architecture.d2?raw';
import sequence from './examples/sequence.d2?raw';
import schema from './examples/schema.d2?raw';
import boards from './examples/boards.d2?raw';
import states from './examples/states.d2?raw';
import diagnostics from './examples/diagnostics.d2?raw';

export interface DiagramExample {
  name: string;
  title: string;
  description: string;
  source: string;
}

export const examples: readonly DiagramExample[] = [
  { name: 'order.d2', title: 'Order flow', description: 'Nested drill-down, breadcrumbs and parent connections.',
    source: '# Click Checkout to open its detail board.\n' + order },
  // Builder output reopens in the builders only without a comment above it, so the description explains the demo.
  { name: 'mixed.d2', title: 'Flows & mind maps', description: 'A flow whose steps open a mind map and a flow. Select a shape to add boards; Edit flow and Edit mind map change the board on view.', source: mixed },
  { name: 'flowchart.d2', title: 'Flowchart basics', description: 'Shapes, decisions, edge labels and Markdown notes.', source: flowchart },
  { name: 'architecture.d2', title: 'Service architecture', description: 'Containers, variables, reusable classes and styled connections.', source: architecture },
  { name: 'sequence.d2', title: 'Sequence diagram', description: 'Participants, ordered messages, groups and replies.', source: sequence },
  { name: 'schema.d2', title: 'Database schema', description: 'SQL tables, primary keys and column-level relationships.', source: schema },
  { name: 'boards.d2', title: 'Layers, scenarios & steps', description: 'Independent detail views, alternate states and cumulative changes.', source: boards },
  { name: 'states.d2', title: 'States & boundary ports', description: 'State transitions and explicit input/output contracts.', source: states },
  { name: 'diagnostics.d2', title: 'Find & fix a broken link', description: 'An intentional lint error with instructions to repair it.', source: diagnostics },
];
