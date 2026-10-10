import { LineChart, type LineChartProps } from '@mantine/charts';
import { useMemo } from 'react';
import { HISTORY_MINUTES } from '../../api/queryKeys';
import { SIGNALS, type ReadingDto, type Signal } from '../../api/types';
import { formatClock, formatSignalValue, formatTime } from '../../lib/format';
import { SIGNAL_LABEL } from '../../lib/labels';
import { useNow } from '../../lib/useNow';
import { thinPoints, toChartPoints } from './chartData';

// Every object, array and function handed to the chart is either a module
// constant or memoized: Recharts compares most axis props by reference and
// re-dispatches the axis settings to its internal store when they change.

const SIGNAL_COLOR: Record<Signal, string> = {
  productionCount: 'blue.6',
  motorTempC: 'orange.6',
  motorCurrentA: 'teal.6',
  scrapCount: 'red.6',
  state: 'violet.6',
};

const SERIES = Object.fromEntries(
  SIGNALS.map((s) => [s, [{ name: 'value', label: SIGNAL_LABEL[s], color: SIGNAL_COLOR[s] }]]),
) as Record<Signal, LineChartProps['series']>;

const VALUE_FORMATTERS = Object.fromEntries(
  SIGNALS.map((s) => [s, (value: number) => formatSignalValue(s, value)]),
) as Record<Signal, (value: number) => string>;

const formatTick = (t: number) => formatClock(t);

const STATE_Y_AXIS: LineChartProps['yAxisProps'] = {
  domain: [0, 2],
  ticks: [0, 1, 2],
  width: 90,
  allowDecimals: false,
};
const VALUE_Y_AXIS: LineChartProps['yAxisProps'] = { domain: ['auto', 'auto'], width: 90 };

const TOOLTIP_PROPS: LineChartProps['tooltipProps'] = {
  labelFormatter: (t) => formatTime(Number(t)),
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
  const to = Math.max(now, data.at(-1)?.t ?? now);
  const xAxisProps = useMemo<LineChartProps['xAxisProps']>(
    () => ({
      type: 'number',
      scale: 'time',
      domain: [from, to],
      allowDataOverflow: true,
      tickFormatter: formatTick,
      minTickGap: 40,
    }),
    [from, to],
  );

  return (
    <LineChart
      h={360}
      data={data}
      dataKey="t"
      series={SERIES[signal]}
      curveType={step ? 'stepAfter' : 'linear'}
      withDots={false}
      strokeWidth={step ? 2 : 1.5}
      valueFormatter={VALUE_FORMATTERS[signal]}
      xAxisProps={xAxisProps}
      yAxisProps={step ? STATE_Y_AXIS : VALUE_Y_AXIS}
      tooltipProps={TOOLTIP_PROPS}
    />
  );
}
