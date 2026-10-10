// @vitest-environment jsdom
import { MantineProvider } from '@mantine/core';
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { ReadingDto, Signal } from '../../api/types';
import { installDomShims } from '../../test/domSetup';
import { HistoryChart } from './HistoryChart';

const NOW = Date.parse('2026-10-10T12:00:00.000Z');

function readings(count: number): ReadingDto[] {
  return Array.from({ length: count }, (_, i) => {
    const ts = new Date(NOW - (count - i) * 1000).toISOString();
    return {
      ts,
      receivedAt: ts,
      productionCount: 1000 + i,
      scrapCount: 10 + Math.floor(i / 50),
      motorTempC: 63.2 + Math.sin(i / 10),
      motorCurrentA: 13.84,
      state: i % 300 < 250 ? 'RUNNING' : 'STOPPED',
    };
  });
}

function renderChart(signal: Signal, data: ReadingDto[]) {
  return render(
    <MantineProvider>
      <HistoryChart readings={data} signal={signal} />
    </MantineProvider>,
  );
}

describe('HistoryChart', () => {
  beforeAll(() => {
    installDomShims();
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it.each<Signal>(['productionCount', 'motorTempC', 'state'])(
    'renders %s without an update loop, also while new readings arrive',
    async (signal) => {
      const errors: unknown[] = [];
      const spy = vi.spyOn(console, 'error').mockImplementation((...args) => {
        errors.push(args.map(String).join(' '));
      });

      let initial = readings(120);
      const { container, rerender } = renderChart(signal, initial);
      // Let effects and Recharts' store subscriptions settle.
      await act(async () => {
        await new Promise((r) => setTimeout(r, 50));
      });

      // A live reading arrives: new array, as the SSE cache update produces.
      initial = [...initial, ...readings(1).map((r) => ({ ...r, ts: new Date(NOW).toISOString() }))];
      rerender(
        <MantineProvider>
          <HistoryChart readings={initial} signal={signal} />
        </MantineProvider>,
      );
      await act(async () => {
        await new Promise((r) => setTimeout(r, 50));
      });

      spy.mockRestore();
      expect(errors.filter((e) => String(e).includes('Maximum update depth'))).toEqual([]);
      // The chart was actually drawn (not skipped because of a zero size).
      expect(container.querySelector('.recharts-line-curve, .recharts-line path')).not.toBeNull();
    },
  );
});
