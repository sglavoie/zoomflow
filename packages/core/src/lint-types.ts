import type { CompileResponse } from '@d2lang/d2';

export type LintRule = 'boundary-in' | 'boundary-out' | 'orphan-board' | 'dangling-link' | 'ignored-link' | 'missing-backlink'
  | 'undefined-class' | 'unsupported-label' | 'dangling-file-link' | 'missing-file-board' | 'bare-file-link';

export interface LintDiagnostic {
  rule: LintRule;
  severity: 'error' | 'warning';
  message: string;
  board: string;
  shape?: string;
  /** Compiled connection ID, such as `(a -> b)[0]`, for dangling connection links. */
  connection?: string;
  /** Resolved missing board ID for dangling-link diagnostics; the authored href for dangling-file-link ones. */
  target?: string;
  /** Original D2 range, possibly in an imported file. Never assume it is index. */
  range?: string;
}

export interface LintOptions {
  missingBacklink?: boolean;
  /** Validate zf-in/zf-out contracts where a child layer declares ports. */
  boundaryPorts?: boolean;
  /** The project around the linted file, so links to other `.d2` files can be checked.
   * Without it, file links are not reported: a single file cannot know its neighbours. */
  files?: {
    /** Project path of the linted file. File links resolve from the file that wrote them, this one or an import. */
    inputPath: string;
    /** Whether links may not open hidden or build folders, which the web app's project scan leaves out (default true). */
    scanned?: boolean;
    /** Whether a project path names a `.d2` file in the project. */
    exists(path: string): boolean;
    /** Board hashes (as `indexBoards` gives them) of a project file, when known. */
    boards?(path: string): ReadonlySet<string> | undefined;
  };
}

export interface BoundaryEvaluation {
  board: string;
  shape: string;
  child: string;
  /** Distinct directed neighbour requirements, independent of labels/parallel edges. */
  expected: number;
  /** Requirements for which at least one correctly named classed port exists. */
  evaluated: number;
}

export interface LintResult {
  diagnostics: LintDiagnostic[];
  boundaryPairsEvaluated: number;
  boundaries: BoundaryEvaluation[];
}

export type LintInput = Pick<CompileResponse, 'diagram' | 'graph'> & Partial<Pick<CompileResponse, 'fs' | 'inputPath'>>;
