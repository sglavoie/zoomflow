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

The state pieces use a fixed slate fill, while the other classes inherit D2's
neutral palettes. Standard D2 style overrides remain available.
