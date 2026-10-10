import { useSyncExternalStore } from 'react';

// One shared clock per interval for every relative time on screen, instead of
// a timer per component.

interface Clock {
  now: number;
  listeners: Set<() => void>;
  timer?: ReturnType<typeof setInterval>;
}

const clocks = new Map<number, Clock>();

function getClock(intervalMs: number): Clock {
  let clock = clocks.get(intervalMs);
  if (!clock) {
    clock = { now: Date.now(), listeners: new Set() };
    clocks.set(intervalMs, clock);
  }
  return clock;
}

function subscribe(intervalMs: number, listener: () => void): () => void {
  const clock = getClock(intervalMs);
  clock.listeners.add(listener);
  if (!clock.timer) {
    clock.now = Date.now();
    clock.timer = setInterval(() => {
      clock.now = Date.now();
      clock.listeners.forEach((l) => l());
    }, intervalMs);
  }
  return () => {
    clock.listeners.delete(listener);
    if (clock.listeners.size === 0) {
      clearInterval(clock.timer);
      clock.timer = undefined;
    }
  };
}

/** Current time in ms, updated every `intervalMs`. */
export function useNow(intervalMs = 1_000): number {
  return useSyncExternalStore(
    (listener) => subscribe(intervalMs, listener),
    () => getClock(intervalMs).now,
  );
}
