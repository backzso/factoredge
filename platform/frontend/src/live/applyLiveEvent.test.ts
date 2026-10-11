import { QueryClient } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { qk } from '../api/queryKeys';
import type { ActiveAlarm, Device, LatestReadings, ReadingDto, TelemetryEvent } from '../api/types';
import { notifyAlarm } from '../components/notify';
import { applyLiveEvent } from './applyLiveEvent';

vi.mock('../components/notify', () => ({ notifyAlarm: vi.fn() }));

const reading = (motorTempC: number): ReadingDto => ({
  ts: '2026-10-11T10:00:00.000Z',
  receivedAt: '2026-10-11T10:00:00.010Z',
  productionCount: 1,
  scrapCount: 0,
  motorTempC,
  motorCurrentA: 22,
  state: 'FAULT',
});

const alarm = (peakC: number, raisedAt = '2026-10-11T09:59:50.000Z'): ActiveAlarm => ({
  signal: 'motorTempC',
  raisedAt,
  peakC,
  raiseC: 90,
  clearC: 85,
});

const device = (deviceAlarm: ActiveAlarm | null): Device => ({
  id: 'd2',
  name: 'Bant 2',
  protocol: 'MQTT',
  enabled: true,
  createdAt: '',
  updatedAt: '',
  config: { brokerUrl: 'mqtt://b:1883', topicPrefix: 'factory/line2', staleAfterMs: 3000 },
  health: { status: 'ONLINE', lastSeenAt: null, lastError: null },
  alarm: deviceAlarm,
});

const telemetry = (temp: number, telemetryAlarm: ActiveAlarm | null): TelemetryEvent => ({
  type: 'telemetry',
  data: { deviceId: 'd2', reading: reading(temp), alarm: telemetryAlarm },
});

describe('applyLiveEvent: telemetry and the alarm it carries', () => {
  let queryClient: QueryClient;
  const shown = () => ({
    current: queryClient.getQueryData<LatestReadings>(qk.latest)?.d2?.motorTempC,
    peak: queryClient.getQueryData<Device[]>(qk.devices)?.[0]?.alarm?.peakC ?? null,
  });

  beforeEach(() => {
    vi.mocked(notifyAlarm).mockClear();
    queryClient = new QueryClient();
    queryClient.setQueryData(qk.devices, [device(alarm(105.8))]);
    queryClient.setQueryData<LatestReadings>(qk.latest, { d2: reading(105.8) });
  });

  it('updates the reading and the peak in the same step: never current > peak', () => {
    applyLiveEvent(queryClient, telemetry(106.4, alarm(106.4)), Date.now());
    expect(shown()).toEqual({ current: 106.4, peak: 106.4 });
  });

  it('clears the alarm with the sample that clears it', () => {
    applyLiveEvent(queryClient, telemetry(85, null), Date.now());
    expect(shown()).toEqual({ current: 85, peak: null });
  });

  it('notifies a newly raised alarm once, not on its later peaks', () => {
    queryClient.setQueryData(qk.devices, [device(null)]);
    const raisedAt = '2026-10-11T10:00:00.010Z';
    applyLiveEvent(queryClient, telemetry(90.7, alarm(90.7, raisedAt)), Date.now());
    applyLiveEvent(queryClient, telemetry(93.1, alarm(93.1, raisedAt)), Date.now());
    applyLiveEvent(queryClient, telemetry(95.4, alarm(95.4, raisedAt)), Date.now());

    expect(notifyAlarm).toHaveBeenCalledTimes(1);
    expect(notifyAlarm).toHaveBeenCalledWith(
      'Yüksek sıcaklık alarmı',
      '“Bant 2” motor sıcaklığı 90,7 °C (eşik 90 °C).',
    );
  });
});
