#!/usr/bin/env node
try {
  // A non-literal specifier keeps typechecking independent of the build output.
  const entry = '../dist/index.js';
  /** @type {{ main(): Promise<number> }} */
  const { main } = await import(entry);
  process.exitCode = await main();
} catch (error) {
  console.error(`zoomflow: ${error instanceof Error ? error.message : error}\nRun pnpm --filter cli build after installing dependencies.`);
  process.exitCode = 2;
}
