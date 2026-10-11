import type { DeviceStatus } from '../device-health/derive-status';
import { EventSeverity, LineState } from '../generated/prisma/client';
import { healthTransition, lineStateTransition } from './event-rules';

/** Feeds statuses in order like the bus does; returns the recorded events. */
function run(statuses: Array<DeviceStatus | [DeviceStatus, string]>) {
  let settled: DeviceStatus | undefined;
  const recorded: Array<{ from: string; to: string; severity: string }> = [];
  for (const item of statuses) {
    const [status, error] = Array.isArray(item) ? item : [item, null];
    const result = healthTransition(settled, status, error);
    settled = result.settled;
    if (result.event) {
      recorded.push({
        from: result.event.data.from,
        to: result.event.data.to,
        severity: result.event.severity,
      });
    }
  }
  return recorded;
}

describe('healthTransition', () => {
  it('records nothing at startup, whatever the first status', () => {
    expect(run(['CONNECTING', 'ONLINE'])).toEqual([]);
    expect(run(['CONNECTING', 'OFFLINE'])).toEqual([]);
    expect(run(['DISABLED'])).toEqual([]);
  });

  it('records ONLINE → STALE and ONLINE → OFFLINE as WARNING', () => {
    expect(run(['ONLINE', 'STALE'])).toEqual([
      { from: 'ONLINE', to: 'STALE', severity: EventSeverity.WARNING },
    ]);
    expect(run(['ONLINE', 'OFFLINE'])).toEqual([
      { from: 'ONLINE', to: 'OFFLINE', severity: EventSeverity.WARNING },
    ]);
  });

  it('records coming back as INFO, across the CONNECTING of a reconnect', () => {
    expect(run(['ONLINE', 'OFFLINE', 'CONNECTING', 'ONLINE'])).toEqual([
      { from: 'ONLINE', to: 'OFFLINE', severity: EventSeverity.WARNING },
      { from: 'OFFLINE', to: 'ONLINE', severity: EventSeverity.INFO },
    ]);
    expect(run(['ONLINE', 'STALE', 'ONLINE'])).toEqual([
      { from: 'ONLINE', to: 'STALE', severity: EventSeverity.WARNING },
      { from: 'STALE', to: 'ONLINE', severity: EventSeverity.INFO },
    ]);
  });

  it('ignores a connector restart that comes back online', () => {
    expect(run(['ONLINE', 'CONNECTING', 'ONLINE'])).toEqual([]);
  });

  it('does not record a device that was already down going further down', () => {
    expect(run(['ONLINE', 'STALE', 'OFFLINE'])).toEqual([
      { from: 'ONLINE', to: 'STALE', severity: EventSeverity.WARNING },
    ]);
  });

  it('records a device first seen offline once it comes back', () => {
    expect(run(['CONNECTING', 'OFFLINE', 'CONNECTING', 'ONLINE'])).toEqual([
      { from: 'OFFLINE', to: 'ONLINE', severity: EventSeverity.INFO },
    ]);
  });

  it('records entering DISABLED as INFO but not leaving it', () => {
    expect(run(['ONLINE', 'DISABLED', 'CONNECTING', 'ONLINE'])).toEqual([
      { from: 'ONLINE', to: 'DISABLED', severity: EventSeverity.INFO },
    ]);
    expect(run(['OFFLINE', 'DISABLED'])).toEqual([
      { from: 'OFFLINE', to: 'DISABLED', severity: EventSeverity.INFO },
    ]);
  });

  it('keeps the error only on a down transition', () => {
    const down = healthTransition('ONLINE', 'OFFLINE', 'ECONNREFUSED');
    expect(down.event?.data).toEqual({
      from: 'ONLINE',
      to: 'OFFLINE',
      error: 'ECONNREFUSED',
    });
    const back = healthTransition('OFFLINE', 'ONLINE', 'stale error');
    expect(back.event?.data).toEqual({ from: 'OFFLINE', to: 'ONLINE' });
  });

  it('keeps settled through CONNECTING', () => {
    expect(healthTransition('OFFLINE', 'CONNECTING', null)).toEqual({
      settled: 'OFFLINE',
      event: null,
    });
  });
});

describe('lineStateTransition', () => {
  const { RUNNING, STOPPED, FAULT } = LineState;

  it('records entering FAULT as CRITICAL', () => {
    expect(lineStateTransition(RUNNING, FAULT)).toEqual({
      type: 'line.fault_started',
      severity: EventSeverity.CRITICAL,
      data: { previousState: RUNNING },
    });
  });

  it('records leaving FAULT as INFO', () => {
    expect(lineStateTransition(FAULT, STOPPED)).toEqual({
      type: 'line.fault_cleared',
      severity: EventSeverity.INFO,
      data: { state: STOPPED },
    });
  });

  it('ignores the normal running/stopped cycle, repeats and the first sample', () => {
    expect(lineStateTransition(RUNNING, STOPPED)).toBeNull();
    expect(lineStateTransition(STOPPED, RUNNING)).toBeNull();
    expect(lineStateTransition(FAULT, FAULT)).toBeNull();
    expect(lineStateTransition(undefined, FAULT)).toBeNull();
  });
});
