import { describe, vi } from 'vitest';
import './cli-helpers';
import { registerCliLintCases } from './cli-lint-cases';
import { registerCliExportCases } from './cli-export-cases';
import { registerCliFilesCases } from './cli-files-cases';

// Every case writes to its own paths, so subprocesses can overlap.
vi.setConfig({ maxConcurrency: 8 });
describe.concurrent('zoomflow CLI', () => {
registerCliLintCases();
registerCliExportCases();
registerCliFilesCases();
});
