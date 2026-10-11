// @vitest-environment jsdom
import { MantineProvider } from '@mantine/core';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ActiveAlarm, Device, ReadingDto } from '../../api/types';
import { LiveStatusContext } from '../../live/liveStatus';
import type { LiveStatus } from '../../live/useLiveStream';
import { installDomShims } from '../../test/domSetup';
import { DeviceCard } from './DeviceCard';

const reading: ReadingDto = {
  ts: '2026-10-10T08:00:00.000Z',
  receivedAt: '2026-10-10T08:00:00.000Z',
  productionCount: 5821,
  scrapCount: 12,
  motorTempC: 63.2,
  motorCurrentA: 13.84,
  state: 'RUNNING',
};

function device(status: Device['health']['status']): Device {
  return {
    id: 'd1',
    name: 'Line 1',
    protocol: 'MODBUS',
    enabled: true,
    createdAt: '',
    updatedAt: '',
    config: { host: 'h', port: 5020, unitId: 1, pollIntervalMs: 1000, timeoutMs: 1000, registerMap: [] },
    health: { status, lastSeenAt: reading.receivedAt, lastError: null },
    alarm: null,
  };
}

function ui(live: LiveStatus, d: Device) {
  return (
    <MantineProvider>
      <LiveStatusContext value={live}>
        <DeviceCard device={d} reading={reading} />
      </LiveStatusContext>
    </MantineProvider>
  );
}

const healthBadge = () => screen.getByText('Çevrimiçi').closest('.mantine-Badge-root') as HTMLElement;
const values = () => screen.getByText('5.821').closest('.mantine-SimpleGrid-root') as HTMLElement;

describe('DeviceCard without a live connection', () => {
  beforeEach(() => installDomShims());
  afterEach(() => cleanup());

  it('shows current health and values while live', () => {
    render(ui('live', device('ONLINE')));
    expect(healthBadge().hasAttribute('data-last-known')).toBe(false);
    expect(values().style.opacity).toBe('1');
    expect(screen.queryByText(/son bilinen durum/)).toBeNull();
  });

  it('does not flag the short connecting phase at start-up', () => {
    render(ui('connecting', device('ONLINE')));
    expect(healthBadge().hasAttribute('data-last-known')).toBe(false);
  });

  it('marks a green "Çevrimiçi" as last known while reconnecting: faded badge, dimmed values, a note', () => {
    render(ui('reconnecting', device('ONLINE')));
    const badge = healthBadge();
    expect(badge.hasAttribute('data-last-known')).toBe(true);
    expect(badge.getAttribute('aria-label')).toBe('Çevrimiçi (son bilinen)');
    expect(badge.style.opacity).toBe('0.5');
    expect(values().style.opacity).toBe('0.45');
    expect(screen.getByText(/son bilinen durum/)).toBeTruthy();
  });

  it('back to normal once live again and the snapshot has corrected the health', () => {
    const { rerender } = render(ui('reconnecting', device('ONLINE')));
    rerender(ui('live', device('OFFLINE')));
    const badge = screen.getByText('Bağlantı yok').closest('.mantine-Badge-root') as HTMLElement;
    expect(badge.hasAttribute('data-last-known')).toBe(false);
    expect(screen.queryByText(/son bilinen durum/)).toBeNull();
    // OFFLINE: values stay visible but dimmed (existing rule).
    expect(values().style.opacity).toBe('0.45');
  });
});

describe('DeviceCard temperature alarm', () => {
  beforeEach(() => installDomShims());
  afterEach(() => cleanup());

  const alarm: ActiveAlarm = {
    signal: 'motorTempC',
    raisedAt: '2026-10-10T07:59:00.000Z',
    peakC: 104.25,
    raiseC: 90,
    clearC: 85,
  };
  const hot = (d: Device): Device => ({ ...d, alarm });
  const hotReading: ReadingDto = { ...reading, motorTempC: 101.43, state: 'FAULT' };
  const strip = () => screen.getByRole('alert');

  function render2(live: LiveStatus, d: Device) {
    render(
      <MantineProvider>
        <LiveStatusContext value={live}>
          <DeviceCard device={d} reading={hotReading} />
        </LiveStatusContext>
      </MantineProvider>,
    );
  }

  it('shows no strip without an alarm', () => {
    render(ui('live', device('ONLINE')));
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('shows the current value, the threshold and the peak while live', () => {
    render2('live', hot(device('ONLINE')));
    expect(strip().textContent).toContain('Yüksek sıcaklık: 101,4 °C · eşik 90 °C');
    expect(strip().textContent).toContain('Tepe 104,3 °C');
    expect(strip().hasAttribute('data-last-known')).toBe(false);
    expect(strip().textContent).not.toContain('son bilinen');
  });

  it('marks the alarm as last known without a live connection or when the device is not online', () => {
    render2('reconnecting', hot(device('ONLINE')));
    expect(strip().hasAttribute('data-last-known')).toBe(true);
    expect(strip().textContent).toContain('son bilinen');
    cleanup();

    render2('live', hot(device('OFFLINE')));
    expect(strip().hasAttribute('data-last-known')).toBe(true);
  });
});
