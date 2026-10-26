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

Shapes:

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

Roles for any diagram. Combine them with other classes, as in `[zf-state; zf-muted]`:

- `zf-emphasis`: a thick, bold outline.
- `zf-muted`: half opacity.
- `zf-external`: a dashed outline, for something outside the system.
- `zf-warning`: an amber outline.
- `zf-note`: an italic page shape.
- `zf-stack`: stacked copies, for many instances of one thing.
- `zf-draft`: a hatched fill, for work in progress.
- `zf-uniform`: a fixed 160 × 64 size, so a row of shapes lines up. Long labels
  overflow it.
- `zf-code`: monospaced text, for identifiers. `zf-caption`: small italic text.
- `zf-group`: a dashed, unfilled container around related shapes.
- `zf-lane`: a swimlane container with its label at the top left.
- `zf-icon-user`, `zf-icon-database`, `zf-icon-server`, `zf-icon-cloud`,
  `zf-icon-document`: a slate line icon that reads in both themes. The icons are
  inline, so interactive HTML and other exports stay offline.

Connections:

- `zf-yes` / `zf-no`: green and dashed red branch lines. The flow builder adds them to
  lines labelled Yes and No.
- `zf-async`: a dashed, animated line. `zf-optional`: a dotted line.
- `zf-to-many`: a crow's foot arrowhead, for one-to-many relationships.

Looks, the builders' **Look** options. Put them last so they override the classes
before them:

- `zf-filled`: a light fill with dark text that reads the same in both themes.
- `zf-compact`: smaller text.
- `zf-shadow`: a drop shadow.

Classes defined on the root board apply on every board below it, so import once at
the top. Lint warns about a class that nothing defines, which catches a misspelt name
or a missing import. D2 reports a connection class used on a shape, such as
`zf-to-many`, as a compile error.

## Project style sheet

Name what a shape is with a class, and keep how each class looks in one file. A
`zoomflow.d2` beside your diagrams replaces the bundled one for `...@zoomflow`, in a
folder opened in the browser and in the CLI. Copy this file and change it; every
diagram that imports it, including the builders' output, follows.

- **Colours** come from the palette in `vars` at the top: `zf-accent-1` to
  `zf-accent-6`, `zf-slate`, `zf-warning`, `zf-yes`, `zf-no`, and `zf-surface` with
  `zf-ink` for filled shapes. Change a value once and every class that uses it
  follows, on every board. The icons draw in slate too, inside their image URLs.
- **D2's own colours**, the ones shapes without a colour class use, change with
  `theme-overrides` and `dark-theme-overrides`. Each takes D2's theme colour codes:
  `N1` to `N7` for text and neutrals, `B1` to `B6` for outlines and fills, and `AA2`
  to `AB5` for accents. This also restyles diagrams that use no classes at all.
- **Class styles** change in `classes`. Keep every class the bundled file defines,
  since the builders and other documents may use any of them, and add your own.

```d2
# zoomflow.d2 in your project: the bundled library with a house look.
vars: {
  d2-config: {
    theme-id: 0
    dark-theme-id: 200
    theme-overrides: {B1: "#1d4ed8"; B6: "#eff6ff"}
    dark-theme-overrides: {B1: "#93c5fd"; B6: "#172554"}
  }
  zf-accent-1: "#b91c1c"
  # ...the rest of the palette, copied from the bundled zoomflow.d2.
}
classes: {
  zf-decision: {
    shape: diamond
    style: {stroke: "#0090ff"; stroke-width: 2}
  }
  zf-emphasis: {style: {stroke-width: 3; bold: true; font-color: ${zf-accent-1}}}
  # ...the other classes, copied from the bundled zoomflow.d2.
  service: {shape: hexagon}
}
```

For diagrams you write yourself, a smaller file works too: import the library and then
your own, as in `...@zoomflow` then `...@house`. A later definition of a class merges
into the earlier one, so `house.d2` needs only what changes. Palette values are an
exception: the library fills them in where it defines its classes, so changing them
needs the full copy above.

```d2
# house.d2: only what changes. Import it after ...@zoomflow.
vars: {
  d2-config: {
    theme-overrides: {B1: "#1d4ed8"}
  }
}
# Keeps the diamond and changes its outline.
classes.zf-decision.style.stroke: "#0090ff"
# A default for every shape on every board.
***.style.font: mono
```

Globs such as `***` set a default on every board, but in D2 a glob wins over a class,
and only a value set on the shape itself wins over the glob. Use a glob only for
something no class you use sets, like `font` above, and use classes for the rest.

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

Classes with a colour take it from the palette; the others inherit D2's neutral
theme colours. Standard D2 style overrides remain available.

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
