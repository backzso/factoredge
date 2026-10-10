/**
 * During shutdown, connections that became idle (e.g. an SSE response that just
 * ended) are closed this often instead of waiting for the keep-alive timeout.
 */
export const CLOSE_IDLE_CONNECTIONS_EVERY_MS = 50;

/**
 * After shutdown begins, connections still open after this long are cut
 * (live streams end on their own well before; this catches anything else,
 * e.g. a request whose body never arrives).
 */
export const FORCE_CLOSE_CONNECTIONS_AFTER_MS = 3_000;

/** Upper bound for the whole shutdown; the process exits with code 1 after it. */
export const SHUTDOWN_TIMEOUT_MS = 10_000;

export const SHUTDOWN_SIGNALS = ['SIGINT', 'SIGTERM'] as const;
