# Browser tests

Playwright starts the Vite app and runs viewer navigation and animation tests in
Chromium, Firefox and WebKit. Install browsers with `pnpm exec playwright install`
and run `pnpm test:e2e` from the workspace root.

The geometry tests pause the actual zoom animation at time zero and measure the
rendered overlay on the next animation frame. They compare all four box dimensions
with the clicked SVG anchor, within 2 px, at two viewport sizes and D2 pad 0/100.
The `?pad=` app parameter controls D2's rendering padding for these checks.
