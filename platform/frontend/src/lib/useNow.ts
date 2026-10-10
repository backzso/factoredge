import { useSyncExternalStore } from 'react';

// One shared clock per interval for every relative time on screen, instead of
// a timer per component.
//
// useSyncExternalStore needs a stable `subscribe` and `getSnapshot`: React
// resubscribes whenever `subscribe` changes identity and re-reads the snapshot
// right after subscribing. Both functions are therefore created once per
// interval and cached here, never per render.

interface Clock {
  now: number;
  listeners: Set<() => void>;
  timer?: ReturnType<typeof setInterval>;
  subscribe: (listener: () => void) => () => void;
  getSnapshot: () => number;
}

const clocks = new Map<number, Clock>();

function getClock(intervalMs: number): Clock {
  const existing = clocks.get(intervalMs);
  if (existing) return existing;

  const clock: Clock = {
    now: Date.now(),
    listeners: new Set(),
    subscribe: (listener) => {
      clock.listeners.add(listener);
      if (!clock.timer) {
        // The clock may have been idle; catch up once when it starts again.
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
    },
    getSnapshot: () => clock.now,
  };
  clocks.set(intervalMs, clock);
  return clock;
}

/** Current time in ms, updated every `intervalMs`. */
export function useNow(intervalMs = 1_000): number {
  const clock = getClock(intervalMs);
  return useSyncExternalStore(clock.subscribe, clock.getSnapshot);
}
