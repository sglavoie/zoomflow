// Keep one D2 compiler and disposal hook for every group of real-compiler cases.
import './lint-helpers';
import { registerLintBoundaryCases } from './lint-boundary-cases';
import { registerLintLibraryCases } from './lint-library-cases';
import { registerLintLinkCases } from './lint-link-cases';
import { registerLintImportCases } from './lint-import-cases';

registerLintBoundaryCases();
registerLintLibraryCases();
registerLintLinkCases();
registerLintImportCases();
