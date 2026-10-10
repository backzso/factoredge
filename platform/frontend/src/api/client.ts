import type { ValidationIssue } from './types';

/** An HTTP error from the API, or a network failure (status 0). */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    /** Field-level config issues (devices endpoints). */
    readonly issues?: ValidationIssue[],
    /** class-validator messages, when the body carried a message array. */
    readonly messages?: string[],
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export function isApiError(error: unknown): error is ApiError {
  return error instanceof ApiError;
}

let onUnauthorized: () => void = () => {};

/** Called on any 401 except the ones a request opted out of (login, me). */
export function setUnauthorizedHandler(handler: () => void): void {
  onUnauthorized = handler;
}

export function notifyUnauthorized(): void {
  onUnauthorized();
}

type Method = 'GET' | 'POST' | 'PATCH' | 'DELETE';

interface RequestOptions {
  method?: Method;
  body?: unknown;
  /** false: a 401 is returned to the caller instead of ending the session. */
  authRedirect?: boolean;
}

export async function api<T>(
  path: string,
  { method = 'GET', body, authRedirect = true }: RequestOptions = {},
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/api${path}`, {
      method,
      credentials: 'same-origin',
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, 'Network error');
  }

  if (response.status === 401 && authRedirect) {
    onUnauthorized();
  }
  if (!response.ok) {
    throw await toApiError(response);
  }
  if (response.status === 204) {
    return undefined as T;
  }
  return (await response.json()) as T;
}

async function toApiError(response: Response): Promise<ApiError> {
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    return new ApiError(response.status, response.statusText);
  }
  const body = (payload ?? {}) as {
    message?: unknown;
    issues?: unknown;
  };
  const messages = Array.isArray(body.message)
    ? body.message.filter((m): m is string => typeof m === 'string')
    : undefined;
  const message =
    typeof body.message === 'string'
      ? body.message
      : (messages?.join('; ') ?? response.statusText);
  const issues = Array.isArray(body.issues)
    ? (body.issues as ValidationIssue[])
    : undefined;
  return new ApiError(response.status, message, issues, messages);
}
