# Lint fixtures

The Vitest helper compiles each entry as `index`, with `stdlib/zoomflow.d2`
available as `zoomflow.d2` and `nodes.d2` available for the imported case. To use
plain D2, copy the stdlib into this directory or change the import path locally.
The browser supplies the stdlib but does not load the separate `nodes.d2` file.

With `--boundary-ports` enabled, `labelled`, `dotted` and `imported` must each
evaluate two boundary pairs with no diagnostics. `mismatched` deliberately uses correct display labels on incorrect
identifiers. `zero-pairs` has edges but no ports. `navigation` has two missing
links, an unlinked layer, a valid cycle and an external URL. `nodes.d2` is the
supporting import, not a standalone lint-clean example.

`nested-navigation` needs no ports by default. Its only error is the deepest
`Capture` link, which mistakenly targets a nonexistent child named `charge`.
Changing that link to `_` makes the fixture lint-clean without the stdlib.
