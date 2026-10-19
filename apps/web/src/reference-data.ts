export interface ReferenceTopic {
  id: string;
  title: string;
  description: string;
  keywords: string;
  source: string;
  docs: string;
}

// Original quick-reference examples, compiled in reference.test.ts against the
// bundled D2 version. Keep these self-contained so Copy always produces valid D2.
export const referenceTopics: readonly ReferenceTopic[] = [
  {
    id: 'shapes', title: 'Shapes and labels',
    description: 'Declare an identifier to create a shape. Add a colon for its display label and a map for attributes. Quote identifiers that contain punctuation such as a dot.',
    keywords: 'node rectangle circle cylinder diamond person database text string',
    source: `client: Web browser
api: API server {
  shape: rectangle
}
store: Records {
  shape: cylinder
}
"v1.0": Release`,
    docs: 'https://d2lang.com/tour/shapes/',
  },
  {
    id: 'connections', title: 'Connections and arrows',
    description: 'Connect identifiers with ->, <-, <->, or --. A colon adds an edge label. Chains create several connections in one statement.',
    keywords: 'edge line link directed bidirectional undirected flow',
    source: `browser -> api: Request
api -> database: Query
api <- database: Results
api <-> cache: Sync
monitor -- api: Observes
queued -> processing -> complete`,
    docs: 'https://d2lang.com/tour/connections/',
  },
  {
    id: 'containers', title: 'Containers and nesting',
    description: 'Nest shapes inside a map to group them. Use dotted paths to reach nested shapes. Inside a container, _ refers to its parent scope.',
    keywords: 'group hierarchy scope parent dot nested',
    source: `customer
platform: Service platform {
  api: API
  database: {shape: cylinder}
  api -> database
  _.customer -> api
}
platform.api -> audit: Log`,
    docs: 'https://d2lang.com/tour/containers/',
  },
  {
    id: 'styles', title: 'Styling shapes and connections',
    description: 'Set appearance with style attributes. Hex colors need quotes because # starts a comment. Apply a style map to a shape or a connection.',
    keywords: 'color colour fill stroke border opacity dashed font size bold',
    source: `service: {
  style: {
    fill: "#e4efff"
    stroke: "#235db8"
    border-radius: 10
    font-size: 18
    bold: true
  }
}
service -> worker: Async {
  style.stroke-dash: 4
}`,
    docs: 'https://d2lang.com/tour/style/',
  },
  {
    id: 'classes', title: 'Reusable classes',
    description: 'Define shared attributes in classes, then apply a class by name. Attributes set directly on a shape override the class values.',
    keywords: 'reuse template theme shared styling override',
    source: `classes: {
  service: {
    shape: rectangle
    style.fill: "#dcefe4"
    style.border-radius: 8
  }
}
api: {class: service}
worker: {
  class: service
  style.fill: "#fff0cc"
}
api -> worker`,
    docs: 'https://d2lang.com/tour/classes/',
  },
  {
    id: 'variables', title: 'Variables and substitutions',
    description: 'Define reusable values in vars and insert them with ${name}. Dotted names access nested variables. Variables can also be read from an outer scope.',
    keywords: 'vars substitution value constant palette configuration',
    source: `vars: {
  service-name: Billing
  palette: {
    accent: "#e4efff"
  }
}
service: \${service-name} {
  style.fill: \${palette.accent}
}`,
    docs: 'https://d2lang.com/tour/vars/',
  },
  {
    id: 'layout', title: 'Direction and dimensions',
    description: 'Use direction to arrange the flow: right, left, down, or up. Width and height set shape dimensions. Zoomflow uses the ELK layout engine.',
    keywords: 'layout horizontal vertical size width height orientation elk',
    source: `direction: right
input: {
  width: 140
  height: 70
}
input -> transform -> output`,
    docs: 'https://d2lang.com/tour/layouts/',
  },
  {
    id: 'layers', title: 'Layers and diagram navigation',
    description: 'Each layer is a separate board. Set link: layers.name to open a child board in Zoomflow, and link: _ to return to its parent. Layers can contain further layers.',
    keywords: 'board drill down child parent back navigation zoomflow link',
    source: `overview: Checkout {
  link: layers.checkout
}
layers: {
  checkout: {
    cart -> payment -> receipt
    back: Overview {link: _}
  }
}`,
    docs: 'https://d2lang.com/tour/layers/',
  },
  {
    id: 'comments', title: 'Comments and multiline text',
    description: 'Start a line comment with #, or toggle selected lines with ⌘/ or Ctrl+/. Use a pipe-delimited block for a multiline Markdown label. Open this reference with ⌘⇧/ or Ctrl+Shift+/.',
    keywords: 'annotation markdown label documentation heading newline',
    source: `# Describe why this step exists.
review: |md
  **Review**

  - Check the input
  - Approve the result
|
review -> approved # An inline comment`,
    docs: 'https://d2lang.com/tour/text/',
  },
];
