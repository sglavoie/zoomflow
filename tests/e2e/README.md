# Browser tests

Playwright is configured at the workspace root for Chromium, Firefox, and WebKit.
Add viewer and export tests here as those features are implemented. Until then,
`pnpm test:e2e` accepts an empty suite; it does not claim browser coverage.

Install browser binaries with `pnpm exec playwright install` before running browser tests.
