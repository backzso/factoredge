// Detects a live stream that is open but silent.
//
// A proxy in front of the backend (the Vite dev proxy does this) may keep the
// browser's SSE connection open after the backend is gone: EventSource then
// gets neither events nor an error. The backend sends a heartbeat every 5 s,
// so no event at all for 15 s means the connection is dead.
//
// Pure: the caller passes the time and owns the single timer.

export const SILENCE_TIMEOUT_MS = 15_000;

export interface SilenceWatch {
  /** Last sign of life: the stream was opened or any event (heartbeat included) arrived. */
  lastActivityAt: number;
}

export type SilenceCheck =
  | { silent: true }
  /** Not silent yet: check again in this many ms (exactly when it would expire). */
  | { silent: false; checkAgainInMs: number };

export function startWatch(now: number): SilenceWatch {
  return { lastActivityAt: now };
}

export function recordActivity(watch: SilenceWatch, now: number): SilenceWatch {
  // A clock that went backwards must not push the deadline into the past.
  return { lastActivityAt: Math.max(watch.lastActivityAt, now) };
}

export function checkSilence(
  watch: SilenceWatch,
  now: number,
  timeoutMs: number = SILENCE_TIMEOUT_MS,
): SilenceCheck {
  const remaining = watch.lastActivityAt + timeoutMs - now;
  return remaining <= 0 ? { silent: true } : { silent: false, checkAgainInMs: remaining };
}
