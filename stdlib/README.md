# Standard library

`zoomflow.d2` is valid D2. Spread-import it to add the classes and neutral default
light/dark themes:

```d2
...@zoomflow
start.class: zf-initial
working.class: zf-state
end.class: zf-final
start -> working -> end
```

The browser provides `zoomflow.d2` in the compiler's virtual filesystem. For
plain D2, copy this file beside your document or adjust the relative import path.
The library is opt-in; existing documents are not rewritten.

- `zf-in` / `zf-out`: dashed oval boundary ports.
- `zf-initial`: small filled circle.
- `zf-final`: filled circle with a double border.
- `zf-state`: rounded rectangle.
- `zf-step` / `zf-decision` / `zf-terminal`: the flow builder's actions (rectangle),
  decisions (diamond) and start or end points (oval).
- `zf-topic` / `zf-branch` / `zf-leaf`: mind map pills for the central topic, its
  main branches and deeper topics.
- `zf-accent-1` to `zf-accent-6`: a branch colour for the outlines of topics and the
  lines between them.
- `zf-emphasis`, `zf-muted`, `zf-external`, `zf-warning`, `zf-note`: roles for any
  diagram: a thick bold outline, half opacity, a dashed outline, an amber outline, and
  an italic page shape. Combine them with other classes, as in `[zf-state; zf-muted]`.
- `zf-filled` / `zf-compact`: the builders' **Look** options, a light fill with dark
  text that reads the same in both themes, and smaller text. Put them last so they
  override the classes before them.

## Project style sheet

Name what a shape is with a class, and keep how each class looks in one file. A
`zoomflow.d2` beside your diagrams replaces the bundled one for `...@zoomflow`, in a
folder opened in the browser and in the CLI. Copy this file, change the class
styles and add your own classes; every diagram that imports it, including the
builders' output, follows:

```d2
# zoomflow.d2 in your project: the bundled library with a house look.
vars: {
  d2-config: {
    theme-id: 0
    dark-theme-id: 200
  }
}
classes: {
  zf-decision: {
    shape: diamond
    style: {stroke: "#0090ff"; stroke-width: 2}
  }
  zf-emphasis: {style: {stroke-width: 3; bold: true; font-color: "#e5484d"}}
  # ...the other classes, copied from the bundled zoomflow.d2.
  service: {shape: hexagon}
}
```

Keep every class the bundled file defines, since the builders and other documents may
use any of them. For diagrams you write yourself, a smaller file works too: import the
library and then your own, as in `...@zoomflow` then `...@house`. A later definition of
a class merges into the earlier one, so `house.d2` needs only what changes:
`classes.zf-decision.style.stroke: "#0090ff"` keeps the diamond and changes its outline.

Classes defined on the root board apply on every board below it, so import once at the
top. Lint warns about a class that nothing defines, which catches a misspelt name or a
missing import.

Boundary ports are optional. Ordinary drill-down diagrams need only a board link;
the viewer infers parent connection hints without adding ports to your source.
Enable **Check boundary ports** in the editor, `--boundary-ports` in the CLI, or
`lint(compiled, { boundaryPorts: true })` to validate child layers that declare
`zf-in` or `zf-out` ports. Port-free layers remain valid with checking enabled.

When using explicit ports, use the **same full identifier** as the neighbour outside the
parent's drillable node. Labels can differ. For `a: Browse catalogue`, name its
child port `a`, not `Browse catalogue`. For `shop.browse`, use `shop.browse` in
the child too; `"shop.browse"` is a different, literal identifier in D2.

```d2
...@zoomflow
browse: Browse catalogue
receipt: Receipt
browse -> checkout -> receipt
checkout.link: layers.checkout
layers.checkout: {
  browse: Entry {class: zf-in}
  receipt: Exit {class: zf-out}
  browse -> work -> receipt
  work.class: zf-state
  back.link: _
}
```

With boundary checking enabled, lint compares each shape linked to an immediate child layer
that declares boundary ports with that child's ports. Once a layer declares any
port, all of its parent neighbours need matching ports. Reverse arrows reverse
the requirements; bidirectional arrows require
both classes. Parallel edges to the same neighbour share one requirement.
Unconnected or incorrectly named ports are errors. A node with declared ports and
incident edges but zero matched boundary pairs produces an error, including when its
edges are undirected. Scenario switches, sibling links and ancestor links do not
establish a parent/child boundary contract.

The state pieces, `zf-filled` and the accent and warning outlines use fixed colours,
while the other classes inherit D2's neutral palettes. Standard D2 style overrides
remain available.

Mind map classes combine a role with an accent. Use undirected `--` lines so the
map has no arrowheads. Detail boards inherit the root board's classes, so the import
at the top covers them:

```d2
...@zoomflow
direction: right
plan: Plan {class: zf-topic}
people: People {class: [zf-branch; zf-accent-1]}
hiring: Hiring {class: [zf-leaf; zf-accent-1]; link: layers.hiring}
plan -- people: {class: zf-accent-1}
people -- hiring: {class: zf-accent-1}
layers.hiring: {
  hiring: Hiring {class: [zf-topic; zf-accent-1]}
}
```

**New mind map** in the browser writes this structure from an indented outline.
