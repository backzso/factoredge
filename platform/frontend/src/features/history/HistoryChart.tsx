import { LineChart } from '@mantine/charts';
import { useMemo } from 'react';
import { HISTORY_MINUTES } from '../../api/queryKeys';
import type { ReadingDto, Signal } from '../../api/types';
import { formatClock, formatSignalValue, formatTime } from '../../lib/format';
import { SIGNAL_LABEL } from '../../lib/labels';
import { useNow } from '../../lib/useNow';
import { thinPoints, toChartPoints } from './chartData';

const SIGNAL_COLOR: Record<Signal, string> = {
  productionCount: 'blue.6',
  motorTempC: 'orange.6',
  motorCurrentA: 'teal.6',
  scrapCount: 'red.6',
  state: 'violet.6',
};

// The time window slides every 5 s; new readings redraw the chart anyway.
const WINDOW_TICK_MS = 5_000;

export function HistoryChart({
  readings,
  signal,
}: {
  readings: readonly ReadingDto[];
  signal: Signal;
}) {
  const now = useNow(WINDOW_TICK_MS);
  const step = signal === 'state';
  const data = useMemo(
    () => thinPoints(toChartPoints(readings, signal), step),
    [readings, signal, step],
  );
  const from = now - HISTORY_MINUTES * 60_000;
  const valueFormatter = (value: number) => formatSignalValue(signal, value);

  return (
    <LineChart
      h={360}
      data={data}
      dataKey="t"
      series={[{ name: 'value', label: SIGNAL_LABEL[signal], color: SIGNAL_COLOR[signal] }]}
      curveType={step ? 'stepAfter' : 'linear'}
      withDots={false}
      strokeWidth={step ? 2 : 1.5}
      valueFormatter={valueFormatter}
      xAxisProps={{
        type: 'number',
        scale: 'time',
        domain: [from, Math.max(now, data.at(-1)?.t ?? now)],
        allowDataOverflow: true,
        tickFormatter: (t: number) => formatClock(t),
        minTickGap: 40,
      }}
      yAxisProps={
        step
          ? { domain: [0, 2], ticks: [0, 1, 2], width: 90, allowDecimals: false }
          : { domain: ['auto', 'auto'], width: 90 }
      }
      tooltipProps={{ labelFormatter: (t) => formatTime(Number(t)) }}
    />
  );
}
