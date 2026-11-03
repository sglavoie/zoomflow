/** Diagnostic context shared by the browser and local AI server. Locations are one-based. */
export type AiDiagnostic = {
  severity: 'error' | 'warning';
  message: string;
  source?: string;
  filename?: string;
  line?: number;
  column?: number;
};
