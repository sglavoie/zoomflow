import { parseSourceRange, type SourceRange, type LintDiagnostic, type ShapeSource } from '@zoomflow/core';

export type SourceDiagnostic = {
  severity: 'error' | 'warning';
  message: string;
  source?: string;
  filename?: string;
  rawRange?: string;
  range?: SourceRange;
  line?: number;
  column?: number;
};

function location(rawRange: string | undefined, source: string, filename: string): Partial<SourceDiagnostic> {
  const match = rawRange && /^(.*),(\d+):(\d+):\d+-\d+:\d+:\d+$/.exec(rawRange);
  if (!match) return {};
  return { filename: match[1], rawRange, line: Number(match[2]) + 1, column: Number(match[3]) + 1,
    range: parseSourceRange(rawRange!, source, filename) };
}

export function lintDiagnostics(items: LintDiagnostic[], source: string, sources: ShapeSource[], filename = 'index'): SourceDiagnostic[] {
  return items.map((item) => {
    const position = location(item.range, source, filename);
    // An explicit foreign location must never fall back to a same-name local shape.
    if (!item.range) {
      const range = sources.find((entry) => entry.board === item.board && entry.shape === item.shape);
      if (range) {
        const prefix = source.slice(0, range.from);
        Object.assign(position, { filename, range, line: prefix.split('\n').length,
          column: range.from - prefix.lastIndexOf('\n') });
      }
    }
    return { ...position, severity: item.severity, source: `Zoomflow ${item.rule}`, message: `${item.board}: ${item.message}` };
  });
}

export function compilerDiagnostics(error: unknown, source: string, filename = 'index'): SourceDiagnostic[] {
  const message = String(error);
  try {
    const entries: unknown = JSON.parse(message.slice(message.indexOf('[')));
    if (Array.isArray(entries)) {
      const diagnostics = entries.flatMap((entry) => {
        if (typeof entry?.range !== 'string' || typeof entry?.errmsg !== 'string') return [];
        return [{ ...location(entry.range, source, filename), severity: 'error' as const, message: entry.errmsg }];
      });
      if (diagnostics.length) return diagnostics;
    }
  } catch { /* Non-parser failures have no trustworthy source location. */ }
  return [{ severity: 'error', message }];
}

export function diagnosticLocation(item: SourceDiagnostic, documentName: string): string {
  const file = item.filename === 'index' ? documentName : item.filename;
  return item.line !== undefined && file ? `${file}:${item.line}:${item.column}` : 'Source location unavailable';
}
