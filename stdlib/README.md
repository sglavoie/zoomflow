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

Boundary ports use the **same full identifier** as the neighbour outside the
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

Lint compares each shape linked to an immediate child layer with that child's
ports. Reverse arrows reverse the requirements; bidirectional arrows require
both classes. Parallel edges to the same neighbour share one requirement.
Unconnected or incorrectly named ports are errors. A node with incident edges
and zero matched boundary pairs always produces an error, including when its
edges are undirected. Scenario switches, sibling links and ancestor links do not
establish a parent/child boundary contract.

The state pieces use a fixed slate fill, while the other classes inherit D2's
neutral palettes. Standard D2 style overrides remain available.
