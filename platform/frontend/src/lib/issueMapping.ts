import { ApiError } from '../api/client';
import { translateApiMessage } from '../api/errors';
import type { ValidationIssue } from '../api/types';

/** Backend issue path → @mantine/form path: "config.registerMap[3].offset" → "config.registerMap.3.offset". */
export function toFormPath(path: string): string {
  return path.replace(/\[(\d+)\]/g, '.$1');
}

/**
 * class-validator messages start with the property name ("username must be…").
 * A message whose first word is one of `fields` is attached to that field;
 * the rest get an empty path (form-level).
 */
export function issuesFromMessages(
  messages: readonly string[],
  fields: readonly string[],
): ValidationIssue[] {
  return messages.map((message) => {
    const firstWord = message.split(/\s/, 1)[0] ?? '';
    return {
      path: fields.includes(firstWord) ? firstWord : '',
      message,
    };
  });
}

/** Issues of a 400 response: zod issues if present, otherwise class-validator messages. */
export function issuesFromError(
  error: ApiError,
  fields: readonly string[],
): ValidationIssue[] {
  if (error.issues && error.issues.length > 0) {
    return error.issues;
  }
  if (error.messages && error.messages.length > 0) {
    return issuesFromMessages(error.messages, fields);
  }
  return [];
}

export interface MappedIssues {
  /** Keyed by form path; several messages for one field are joined. */
  fieldErrors: Record<string, string>;
  /** Issues no rendered field can show, listed above the form. */
  formErrors: string[];
}

export function mapIssuesToForm(
  issues: readonly ValidationIssue[],
  isKnownField: (formPath: string) => boolean,
): MappedIssues {
  const fieldErrors: Record<string, string> = {};
  const formErrors: string[] = [];
  for (const issue of issues) {
    const message = translateApiMessage(issue.message);
    const formPath = toFormPath(issue.path);
    if (formPath !== '' && isKnownField(formPath)) {
      const existing = fieldErrors[formPath];
      fieldErrors[formPath] = existing ? `${existing}\n${message}` : message;
    } else {
      formErrors.push(issue.path ? `${issue.path}: ${message}` : message);
    }
  }
  return { fieldErrors, formErrors };
}
