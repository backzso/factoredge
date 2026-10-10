// @vitest-environment jsdom
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useNow } from './useNow';

/** Burns `ms` of render time, like a chart does. */
function busy(ms: number) {
  const end = performance.now() + ms;
  while (performance.now() < end) {
    // spin
  }
}

describe('useNow', () => {
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  // Regression: a new `subscribe` function per render made React resubscribe
  // after every render; resubscribing restarted the idle clock with a fresh
  // Date.now(), which changed the snapshot and forced another render. With a
  // render slower than 1 ms this never ended ("Maximum update depth exceeded").
  it('does not re-render in a loop when rendering takes longer than a millisecond', async () => {
    let renders = 0;
    function SlowClock() {
      renders += 1;
      const now = useNow(5_000);
      busy(3);
      return <span>{now}</span>;
    }

    const errors: string[] = [];
    const spy = vi.spyOn(console, 'error').mockImplementation((...args) => {
      errors.push(args.map(String).join(' '));
    });
    render(<SlowClock />);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 30));
    });
    spy.mockRestore();

    expect(errors).toEqual([]);
    expect(renders).toBeLessThanOrEqual(3);
  });

  it('ticks every interval and shares one clock between components', async () => {
    vi.useFakeTimers({ now: Date.parse('2026-10-10T12:00:00.000Z') });
    const seen: number[][] = [[], []];
    function Clock({ index }: { index: 0 | 1 }) {
      const now = useNow(1_000);
      seen[index]!.push(now);
      return null;
    }
    render(
      <>
        <Clock index={0} />
        <Clock index={1} />
      </>,
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_000);
    });

    expect(seen[0]!.at(-1)).toBe(Date.parse('2026-10-10T12:00:03.000Z'));
    expect(seen[1]!.at(-1)).toBe(seen[0]!.at(-1));
  });
});
