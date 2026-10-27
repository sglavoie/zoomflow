# Fixtures

Shared D2 examples and regression fixtures live here. Compiler API contract inputs
are kept beside their assertions in `packages/core/test/d2-contract.test.ts`.

`atlas/` is a folder project whose files link to each other: `index.d2` opens
`health.d2` and `work/index.d2`, which opens a board of `projects/zoomflow.d2`.
`broken/links.d2` holds deliberately broken file links and is not reachable from
`index.d2`.
