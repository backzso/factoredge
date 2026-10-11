import {
  type AlarmChange,
  type AlarmState,
  evaluateAlarm,
} from './temperature-alarm';

const thresholds = { raiseC: 90, clearC: 85 };
const t = (s: number) => new Date(Date.UTC(2026, 9, 11, 10, 0, s));

/** Feeds values one per second; returns the changes and the final state. */
function run(values: number[]) {
  let state: AlarmState | undefined;
  const changes: AlarmChange[] = [];
  values.forEach((value, i) => {
    const result = evaluateAlarm(state, value, thresholds, t(i));
    state = result.state;
    changes.push(result.change);
  });
  return { state, changes };
}

describe('evaluateAlarm (hysteresis)', () => {
  it('raises at the threshold, not below it', () => {
    expect(run([89.99]).changes).toEqual([null]);
    expect(run([90])).toEqual({
      state: { raisedAt: t(0), peakC: 90 },
      changes: ['raised'],
    });
  });

  it('stays open while the value wanders around the raise threshold', () => {
    const { state, changes } = run([91, 89, 91, 88, 90, 86]);
    expect(changes).toEqual(['raised', null, null, null, null, null]);
    expect(state).toEqual({ raisedAt: t(0), peakC: 91 });
  });

  it('clears at the clear threshold, not above it', () => {
    expect(run([95, 85.01]).state).toBeDefined();
    expect(run([95, 85])).toEqual({
      state: undefined,
      changes: ['raised', 'cleared'],
    });
  });

  it('tracks the peak while open', () => {
    const { state, changes } = run([92, 101.4, 99, 108.2]);
    expect(changes).toEqual(['raised', 'peak', null, 'peak']);
    expect(state?.peakC).toBe(108.2);
    expect(state?.raisedAt).toEqual(t(0));
  });

  it('opens a new alarm after clearing', () => {
    const { state, changes } = run([95, 80, 89, 93]);
    expect(changes).toEqual(['raised', 'cleared', null, 'raised']);
    expect(state).toEqual({ raisedAt: t(3), peakC: 93 });
  });

  it('ignores a non-finite value', () => {
    expect(run([95, Number.NaN]).changes).toEqual(['raised', null]);
    expect(run([Number.POSITIVE_INFINITY]).changes).toEqual([null]);
  });
});
