import type { Logger } from '@nestjs/common';

const DEFAULT_WINDOW_MS = 60_000;

/**
 * Logs a given message at most once per window. Repeats inside the window are
 * counted and reported with the next occurrence after it, so a device that
 * sends garbage every second produces one line a minute instead of a flood.
 */
export class LogThrottle {
  private readonly seen = new Map<
    string,
    { loggedAt: number; suppressed: number }
  >();

  constructor(
    private readonly logger: Pick<Logger, 'warn' | 'error'>,
    private readonly windowMs = DEFAULT_WINDOW_MS,
    private readonly now: () => number = Date.now,
  ) {}

  warn(message: string): void {
    this.log('warn', message);
  }

  error(message: string): void {
    this.log('error', message);
  }

  private log(level: 'warn' | 'error', message: string): void {
    const now = this.now();
    const entry = this.seen.get(message);
    if (entry && now - entry.loggedAt < this.windowMs) {
      entry.suppressed += 1;
      return;
    }
    const suffix = entry?.suppressed
      ? ` (repeated ${entry.suppressed} more times in the last ${Math.round(this.windowMs / 1000)}s)`
      : '';
    this.seen.set(message, { loggedAt: now, suppressed: 0 });
    // Bounded by the number of distinct messages; drop stale ones occasionally.
    if (this.seen.size > 100) {
      for (const [key, value] of this.seen) {
        if (now - value.loggedAt >= this.windowMs) this.seen.delete(key);
      }
    }
    this.logger[level](message + suffix);
  }
}
