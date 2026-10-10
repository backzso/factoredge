import { describe, expect, it } from 'vitest';
import { type ChartPoint, thinPoints } from './chartData';

const series = (values: number[]): ChartPoint[] => values.map((value, t) => ({ t, value }));

describe('thinPoints', () => {
  it('keeps only value changes and the last point of a step series', () => {
    const points = series([1, 1, 1, 0, 0, 2, 2, 1, 1]);
    expect(thinPoints(points, true)).toEqual([
      { t: 0, value: 1 },
      { t: 3, value: 0 },
      { t: 5, value: 2 },
      { t: 7, value: 1 },
      { t: 8, value: 1 },
    ]);
  });

  it('leaves a short series alone', () => {
    const points = series([1, 2, 3]);
    expect(thinPoints(points, false, 10)).toBe(points);
  });

  it('keeps spikes, time order and the newest point when thinning', () => {
    const values = Array.from({ length: 3600 }, (_, i) => (i === 1234 ? 999 : i === 2345 ? -5 : 50));
    const thinned = thinPoints(series(values), false, 720);
    expect(thinned.length).toBeLessThanOrEqual(721);
    expect(thinned.some((p) => p.value === 999)).toBe(true);
    expect(thinned.some((p) => p.value === -5)).toBe(true);
    expect(thinned.at(-1)).toEqual({ t: 3599, value: 50 });
    expect(thinned.every((p, i) => i === 0 || p.t > thinned[i - 1]!.t)).toBe(true);
  });
});
