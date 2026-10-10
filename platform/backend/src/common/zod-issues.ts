import type { z } from 'zod';

export interface ValidationIssue {
  /** e.g. "config.registerMap[3].offset"; empty for the root value. */
  path: string;
  message: string;
}

/** Flattens zod issues into "which field, and why" pairs for API responses and logs. */
export function formatZodIssues(error: z.ZodError): ValidationIssue[] {
  return error.issues.map((issue) => ({
    path: formatPath(issue.path),
    message: issue.message,
  }));
}

/** One-line summary, for logs. */
export function summarizeZodError(error: z.ZodError): string {
  return formatZodIssues(error)
    .map(({ path, message }) => (path ? `${path}: ${message}` : message))
    .join('; ');
}

function formatPath(path: readonly PropertyKey[]): string {
  return path.reduce<string>((acc, key) => {
    if (typeof key === 'number') {
      return `${acc}[${key}]`;
    }
    const name = String(key);
    return acc ? `${acc}.${name}` : name;
  }, '');
}
