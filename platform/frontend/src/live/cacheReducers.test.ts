import { describe, expect, it } from 'vitest';
import type {
  ActiveAlarm,
  Device,
  DeviceHealth,
  LatestReadings,
  ReadingDto,
  SnapshotEvent,
} from '../api/types';
import {
  appendReading,
  applyAlarmToDevices,
  applySnapshotToDevices,
  applySnapshotToLatest,
  applyStatusToDevices,
  applyTelemetryToDevices,
  applyTelemetryToLatest,
  removeDeviceFromDevices,
  removeDeviceFromLatest,
  trimReadings,
} from './cacheReducers';

const T0 = Date.parse('2026-10-10T12:00:00.000Z');
const iso = (ms: number) => new Date(T0 + ms).toISOString();
const MIN = 60_000;

function reading(ms: number, overrides: Partial<ReadingDto> = {}): ReadingDto {
  return {
    ts: iso(ms),
    receivedAt: iso(ms + 5),
    productionCount: 100 + ms / 1000,
    scrapCount: 2,
    motorTempC: 63.2,
    motorCurrentA: 13.84,
    state: 'RUNNING',
    ...overrides,
  };
}

function device(id: string, health: Partial<DeviceHealth> = {}): Device {
  return {
    id,
    name: `Line ${id}`,
    protocol: 'MQTT',
    enabled: true,
    createdAt: iso(0),
    updatedAt: iso(0),
    config: { brokerUrl: 'mqtt://b:1883', topicPrefix: 'factory/x', staleAfterMs: 3000 },
    health: { status: 'CONNECTING', lastSeenAt: null, lastError: null, ...health },
    alarm: null,
  };
}

function snapshot(...devices: SnapshotEvent['data']['devices']): SnapshotEvent {
  return { type: 'snapshot', data: { devices } };
}

const live = (
  deviceId: string,
  latest: ReadingDto | null,
  health: Partial<DeviceHealth> = {},
  alarm: ActiveAlarm | null = null,
) => ({
  deviceId,
  status: 'ONLINE' as const,
  lastSeenAt: latest?.receivedAt ?? null,
  lastError: null,
  latest,
  alarm,
  ...health,
});

const ALARM: ActiveAlarm = {
  signal: 'motorTempC',
  raisedAt: iso(0),
  peakC: 101.4,
  raiseC: 90,
  clearC: 85,
};

describe('snapshot', () => {
  it('seeds the health of listed devices and leaves the others alone', () => {
    const devices = [device('a'), device('b', { status: 'DISABLED' })];
    const r = reading(0);

    const { devices: next, unknown } = applySnapshotToDevices(
      devices,
      snapshot(live('a', r, { lastError: 'old' })),
    );

    expect(unknown).toBe(false);
    expect(next?.[0]?.health).toEqual({ status: 'ONLINE', lastSeenAt: r.receivedAt, lastError: 'old' });
    expect(next?.[1]).toBe(devices[1]);
  });

  it('reports a device the loaded list does not have', () => {
    const { unknown } = applySnapshotToDevices([device('a')], snapshot(live('a', null), live('new', null)));
    expect(unknown).toBe(true);
  });

  it('leaves a not yet loaded device list undefined', () => {
    expect(applySnapshotToDevices(undefined, snapshot(live('a', null)))).toEqual({
      devices: undefined,
      unknown: false,
    });
  });

  it('replaces latest readings, keeps the previous one when the snapshot has none, drops missing devices', () => {
    const old = reading(0);
    const fresh = reading(1000);
    const latest: LatestReadings = { a: old, b: old, gone: old };

    const next = applySnapshotToLatest(latest, snapshot(live('a', fresh), live('b', null), live('c', null)));

    expect(next).toEqual({ a: fresh, b: old });
  });

  it('builds latest from scratch when nothing was cached', () => {
    const r = reading(0);
    expect(applySnapshotToLatest(undefined, snapshot(live('a', r), live('b', null)))).toEqual({ a: r });
  });
});

describe('telemetry', () => {
  const event = (deviceId: string, r: ReadingDto, alarm: ActiveAlarm | null = null) => ({
    type: 'telemetry' as const,
    data: { deviceId, reading: r, alarm },
  });

  it('stores the latest reading per device', () => {
    const r1 = reading(0);
    const r2 = reading(1000);
    const latest = applyTelemetryToLatest({ a: r1, b: r1 }, event('a', r2));
    expect(latest).toEqual({ a: r2, b: r1 });
    expect(applyTelemetryToLatest(undefined, event('a', r1))).toEqual({ a: r1 });
  });

  it("advances the device's lastSeenAt to the reading's receivedAt", () => {
    const devices = [device('a', { status: 'ONLINE' }), device('b')];
    const r = reading(2000);
    const { devices: next, unknown } = applyTelemetryToDevices(devices, event('a', r));
    expect(unknown).toBe(false);
    expect(next?.[0]?.health).toEqual({ status: 'ONLINE', lastSeenAt: r.receivedAt, lastError: null });
    expect(next?.[1]).toBe(devices[1]);
  });

  it('returns the same list when lastSeenAt did not change', () => {
    const r = reading(0);
    const devices = [device('a', { lastSeenAt: r.receivedAt })];
    expect(applyTelemetryToDevices(devices, event('a', r)).devices).toBe(devices);
  });

  it("applies the sample's alarm with it: raised, new peak, cleared", () => {
    const r = reading(0, { motorTempC: 101.4 });
    const devices = [device('a', { lastSeenAt: r.receivedAt })];
    const raised = applyTelemetryToDevices(devices, event('a', r, ALARM)).devices;
    expect(raised?.[0]?.alarm).toEqual(ALARM);

    const peak = { ...ALARM, peakC: 103.2 };
    expect(applyTelemetryToDevices(raised, event('a', r, peak)).devices?.[0]?.alarm).toEqual(peak);
    // Same alarm, same reading: nothing changed.
    expect(applyTelemetryToDevices(raised, event('a', r, { ...ALARM })).devices).toBe(raised);
    expect(applyTelemetryToDevices(raised, event('a', r, null)).devices?.[0]?.alarm).toBeNull();
  });

  it('flags an unknown device', () => {
    const devices = [device('a')];
    const result = applyTelemetryToDevices(devices, event('zzz', reading(0)));
    expect(result).toEqual({ devices, unknown: true });
  });

  it('does not flag anything while the list is not loaded', () => {
    expect(applyTelemetryToDevices(undefined, event('a', reading(0)))).toEqual({
      devices: undefined,
      unknown: false,
    });
  });
});

describe('appendReading', () => {
  it('appends a newer reading', () => {
    const history = [reading(0), reading(1000)];
    const r = reading(2000);
    expect(appendReading(history, r, T0 + 2000, 60)).toEqual([...history, r]);
  });

  it('drops readings older than the window', () => {
    const history = [reading(0), reading(30 * MIN), reading(59 * MIN)];
    const r = reading(61 * MIN);
    // now = T0 + 61 min → window starts at T0 + 1 min
    expect(appendReading(history, r, T0 + 61 * MIN, 60)).toEqual([history[1], history[2], r]);
  });

  it('keeps a reading exactly at the window start', () => {
    const history = [reading(0)];
    const r = reading(60 * MIN);
    expect(appendReading(history, r, T0 + 60 * MIN, 60)).toEqual([history[0], r]);
  });

  it('ignores a reading that is not newer than the last one', () => {
    const history = [reading(0), reading(1000)];
    expect(appendReading(history, reading(1000), T0 + 1000, 60)).toBe(history);
    expect(appendReading(history, reading(500), T0 + 1000, 60)).toBe(history);
  });

  it('leaves an unloaded history undefined', () => {
    expect(appendReading(undefined, reading(0), T0, 60)).toBeUndefined();
  });

  it('trimReadings returns an empty list when everything is too old', () => {
    expect(trimReadings([reading(0)], T0 + 2 * 60 * MIN, 60)).toEqual([]);
  });
});

describe('status', () => {
  it("replaces the device's health", () => {
    const devices = [device('a', { status: 'ONLINE', lastSeenAt: iso(0) }), device('b')];
    const { devices: next, unknown } = applyStatusToDevices(devices, {
      type: 'status',
      data: { deviceId: 'a', status: 'OFFLINE', lastSeenAt: iso(0), lastError: 'ECONNREFUSED' },
    });
    expect(unknown).toBe(false);
    expect(next?.[0]?.health).toEqual({ status: 'OFFLINE', lastSeenAt: iso(0), lastError: 'ECONNREFUSED' });
    expect(next?.[1]).toBe(devices[1]);
  });

  it('flags an unknown device and leaves the list unchanged', () => {
    const devices = [device('a')];
    const result = applyStatusToDevices(devices, {
      type: 'status',
      data: { deviceId: 'new', status: 'CONNECTING', lastSeenAt: null, lastError: null },
    });
    expect(result).toEqual({ devices, unknown: true });
  });
});

describe('device-removed', () => {
  const removed = (deviceId: string) => ({ type: 'device-removed' as const, data: { deviceId } });

  it('removes the device from the list and from latest', () => {
    const devices = [device('a'), device('b')];
    expect(removeDeviceFromDevices(devices, removed('a'))).toEqual([devices[1]]);
    expect(removeDeviceFromLatest({ a: reading(0), b: reading(0) }, removed('a'))).toEqual({ b: reading(0) });
  });

  it('returns the same objects when the device is not there', () => {
    const devices = [device('a')];
    const latest = { a: reading(0) };
    expect(removeDeviceFromDevices(devices, removed('x'))).toBe(devices);
    expect(removeDeviceFromLatest(latest, removed('x'))).toBe(latest);
    expect(removeDeviceFromDevices(undefined, removed('x'))).toBeUndefined();
  });
});

describe('alarm', () => {
  it('sets and clears the alarm of a listed device', () => {
    const devices = [device('a'), device('b')];
    const raised = applyAlarmToDevices(devices, { type: 'alarm', data: { deviceId: 'a', alarm: ALARM } });
    expect(raised.devices?.[0]?.alarm).toEqual(ALARM);
    expect(raised.devices?.[1]).toBe(devices[1]);

    const cleared = applyAlarmToDevices(raised.devices, {
      type: 'alarm',
      data: { deviceId: 'a', alarm: null },
    });
    expect(cleared.devices?.[0]?.alarm).toBeNull();
  });

  it("ignores an unknown device's alarm without asking for a refetch", () => {
    const devices = [device('a')];
    expect(
      applyAlarmToDevices(devices, { type: 'alarm', data: { deviceId: 'gone', alarm: null } }),
    ).toEqual({ devices, unknown: false });
  });

  it('takes the alarm from the snapshot, which is authoritative', () => {
    const withStale = [{ ...device('a'), alarm: ALARM }, device('b')];
    const { devices } = applySnapshotToDevices(
      withStale,
      snapshot(live('a', reading(0)), live('b', reading(0), {}, ALARM)),
    );
    expect(devices?.map((d) => d.alarm)).toEqual([null, ALARM]);
  });
});
