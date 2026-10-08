import { DURATION_PATTERN } from './env.validation';

const SECONDS_PER_UNIT = { s: 1, m: 60, h: 3600, d: 86400 } as const;

/** Converts a validated duration such as "15m" or "8h" to seconds. */
export function durationToSeconds(duration: string): number {
  if (!DURATION_PATTERN.test(duration)) {
    throw new Error(`Invalid duration: ${duration}`);
  }
  const unit = duration.slice(-1) as keyof typeof SECONDS_PER_UNIT;
  return Number(duration.slice(0, -1)) * SECONDS_PER_UNIT[unit];
}
