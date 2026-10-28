#!/usr/bin/env node
import { fileURLToPath } from 'node:url';

// A non-literal specifier keeps typechecking independent of the build output.
const entry = '../dist/index.js';
/** @type {{ main(): Promise<number> }} */
let cli;
try {
  cli = await import(entry);
} catch (error) {
  // Only a missing build output warrants the build hint; anything else is a real failure.
  const missing = /** @type {{ code?: string }} */ (error).code === 'ERR_MODULE_NOT_FOUND'
    && String(/** @type {Error} */ (error).message).includes(`'${fileURLToPath(new URL(entry, import.meta.url))}'`);
  if (!missing) throw error;
  console.error('zoomflow: the CLI is not built.\nRun pnpm --filter cli build after installing dependencies.');
  process.exit(2);
}
// A reader that closes early, as `| head` does, only stops the output; the exit code still reports the result.
process.stdout.on('error', (error) => { if (/** @type {{ code?: string }} */ (error).code !== 'EPIPE') throw error; });
process.exitCode = await cli.main();
