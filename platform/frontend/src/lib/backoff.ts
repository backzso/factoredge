/** Waits between retries against an unreachable backend; the last one repeats. */
export const RETRY_DELAYS_MS = [1_000, 2_000, 5_000, 10_000] as const;

/** Delay before retry number `attempt` (0-based: 0 = first retry). */
export function backoffDelay(attempt: number): number {
  const index = Math.min(Math.max(0, Math.floor(attempt)), RETRY_DELAYS_MS.length - 1);
  return RETRY_DELAYS_MS[index]!;
}
