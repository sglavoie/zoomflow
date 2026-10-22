// Give each concurrent Playwright invocation its own ZOOMFLOW_E2E_PORT (and port + 1).
export const devPort = Number(process.env.ZOOMFLOW_E2E_PORT ?? 4173);
export const previewPort = devPort + 1;

/** The Vite dev server, which also serves source modules such as `/src/compiler.ts`. */
export const devURL = `http://127.0.0.1:${devPort}`;
/** `vite preview` serving the `pnpm build` output. */
export const previewURL = `http://127.0.0.1:${previewPort}`;
