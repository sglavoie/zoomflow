# Zoomflow

Navigable, drill-down diagrams built on D2.

This initial workspace contains the D2 compiler contract and placeholders for the
core library, DOM viewer, CLI, and browser app. D2 is pinned to `0.1.34`; upgrades
must deliberately review its exact board href and source-range contracts.

Use pnpm 12.6.0 and Node 26 (verified with Node 26.10.0):

```sh
pnpm install
pnpm test:unit
pnpm typecheck
```

`pnpm test` runs unit tests followed by `pnpm test:e2e`. The browser suite currently
has no tests; its scaffold accepts that until viewer behavior is implemented.
