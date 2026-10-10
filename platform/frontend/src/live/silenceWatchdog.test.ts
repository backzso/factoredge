import { describe, expect, it } from 'vitest';
import {
  checkSilence,
  recordActivity,
  type SilenceWatch,
  SILENCE_TIMEOUT_MS,
  startWatch,
} from './silenceWatchdog';

/**
 * Drives the watchdog the way useLiveStream does: one timer, re-armed with
 * checkAgainInMs, events recorded as they arrive. Returns when it fired (or null).
 */
function simulate(eventTimes: number[], until: number, timeoutMs = SILENCE_TIMEOUT_MS): number | null {
  let clock = 0;
  let watch: SilenceWatch = startWatch(clock);
  let timerAt = clock + timeoutMs;
  const events = [...eventTimes].sort((a, b) => a - b);

  while (clock <= until) {
    const nextEvent = events[0];
    if (nextEvent !== undefined && nextEvent <= timerAt) {
      clock = nextEvent;
      events.shift();
      watch = recordActivity(watch, clock);
      continue;
    }
    clock = timerAt;
    if (clock > until) break;
    const check = checkSilence(watch, clock, timeoutMs);
    if (check.silent) return clock;
    timerAt = clock + check.checkAgainInMs;
  }
  return null;
}

const every = (stepMs: number, untilMs: number) =>
  Array.from({ length: Math.floor(untilMs / stepMs) }, (_, i) => (i + 1) * stepMs);

describe('checkSilence', () => {
  it('is not silent right after opening and says when to look again', () => {
    expect(checkSilence(startWatch(1_000), 1_000)).toEqual({ silent: false, checkAgainInMs: 15_000 });
    expect(checkSilence(startWatch(1_000), 9_000)).toEqual({ silent: false, checkAgainInMs: 7_000 });
  });

  it('is silent exactly at the timeout and later', () => {
    expect(checkSilence(startWatch(0), 14_999)).toEqual({ silent: false, checkAgainInMs: 1 });
    expect(checkSilence(startWatch(0), 15_000)).toEqual({ silent: true });
    expect(checkSilence(startWatch(0), 60_000)).toEqual({ silent: true });
  });

  it('any event pushes the deadline', () => {
    const watch = recordActivity(startWatch(0), 10_000);
    expect(checkSilence(watch, 15_000)).toEqual({ silent: false, checkAgainInMs: 10_000 });
    expect(checkSilence(watch, 25_000)).toEqual({ silent: true });
  });

  it('ignores a clock that goes backwards', () => {
    const watch = recordActivity(startWatch(10_000), 5_000);
    expect(watch.lastActivityAt).toBe(10_000);
  });
});

describe('watchdog over a fake clock', () => {
  it('never fires while 5 s heartbeats arrive', () => {
    expect(simulate(every(5_000, 120_000), 120_000)).toBeNull();
  });

  it('tolerates two missed heartbeats', () => {
    // Heartbeats at 5, 10, then nothing until 24.9 s: the gap is 14.9 s.
    expect(simulate([5_000, 10_000, 24_900, 29_900], 40_000)).toBeNull();
  });

  it('fires 15 s after the last event when the stream goes quiet', () => {
    // Backend stops after the heartbeat at 20 s.
    expect(simulate(every(5_000, 20_000), 120_000)).toBe(35_000);
  });

  it('fires 15 s after opening when not even the snapshot arrives', () => {
    expect(simulate([], 60_000)).toBe(15_000);
  });

  it('counts telemetry as activity just like heartbeats', () => {
    // No heartbeats, telemetry every second for a minute, then silence.
    expect(simulate(every(1_000, 60_000), 120_000)).toBe(75_000);
  });
});
