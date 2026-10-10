import type { ReadingDto, Signal } from '../../api/types';
import { lineStateCode } from '../../lib/format';

export interface ChartPoint {
  /** Measurement time, ms since epoch. */
  t: number;
  value: number;
}

/** Above this many points the series is thinned (the chart is narrower than that in pixels). */
export const MAX_CHART_POINTS = 720;

export function toChartPoints(readings: readonly ReadingDto[], signal: Signal): ChartPoint[] {
  return readings.map((r) => ({
    t: Date.parse(r.ts),
    value: signal === 'state' ? lineStateCode(r.state) : r[signal],
  }));
}

/**
 * Thins a series for drawing without changing what it looks like:
 * - step series (line state): only the points where the value changes, plus the
 *   last one; lossless for a step line.
 * - other series: per bucket the min and the max, in time order, so spikes survive.
 */
export function thinPoints(
  points: ChartPoint[],
  step: boolean,
  maxPoints = MAX_CHART_POINTS,
): ChartPoint[] {
  if (step) {
    const kept = points.filter((p, i) => i === 0 || p.value !== points[i - 1]!.value);
    const last = points.at(-1);
    if (last && kept.at(-1) !== last) kept.push(last);
    return kept;
  }
  if (points.length <= maxPoints) return points;

  const bucketCount = Math.floor(maxPoints / 2);
  const bucketSize = points.length / bucketCount;
  const result: ChartPoint[] = [];
  for (let b = 0; b < bucketCount; b++) {
    const start = Math.floor(b * bucketSize);
    const end = Math.min(points.length, Math.floor((b + 1) * bucketSize));
    let min = points[start]!;
    let max = min;
    for (let i = start + 1; i < end; i++) {
      const p = points[i]!;
      if (p.value < min.value) min = p;
      if (p.value > max.value) max = p;
    }
    if (min === max) result.push(min);
    else result.push(...(min.t < max.t ? [min, max] : [max, min]));
  }
  // Keep the newest sample so the line reaches "now".
  const last = points.at(-1)!;
  if (result.at(-1) !== last) result.push(last);
  return result;
}
