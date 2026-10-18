#!/usr/bin/env node
try {
  const { main } = await import('../dist/index.js');
  process.exitCode = await main();
} catch (error) {
  console.error(`zoomflow: ${error.message}\nRun pnpm --filter cli build after installing dependencies.`);
  process.exitCode = 2;
}
