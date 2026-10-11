import type { DeviceStatus } from '../device-health/derive-status';
import { EventSeverity, LineState } from '../generated/prisma/client';
import { RealtimeService } from '../realtime/realtime.service';
import type { ReadingDto } from '../telemetry/reading.mapper';
import type { NewEvent } from './event-types';
import { DeviceEventRecorder } from './device-event-recorder.service';
import type { EventsService } from './events.service';

const reading = (state: LineState): ReadingDto => ({
  ts: '2026-10-11T10:00:00.000Z',
  receivedAt: '2026-10-11T10:00:00.000Z',
  productionCount: 1,
  scrapCount: 0,
  motorTempC: 60,
  motorCurrentA: 12,
  state,
});

describe('DeviceEventRecorder', () => {
  let realtime: RealtimeService;
  let recorded: NewEvent[];
  let recorder: DeviceEventRecorder;

  beforeEach(() => {
    realtime = new RealtimeService();
    recorded = [];
    const events = {
      record: (event: NewEvent) => recorded.push(event),
    } as unknown as EventsService;
    recorder = new DeviceEventRecorder(realtime, events);
    recorder.onModuleInit();
  });

  afterEach(() => recorder.onModuleDestroy());

  const status = (deviceId: string, status: DeviceStatus) =>
    realtime.publish({
      type: 'status',
      data: { deviceId, status, lastSeenAt: null, lastError: null },
    });
  const telemetry = (deviceId: string, state: LineState) =>
    realtime.publish({
      type: 'telemetry',
      data: { deviceId, reading: reading(state), alarm: null },
    });

  it('records health transitions per device, with the device id', () => {
    status('a', 'ONLINE');
    status('b', 'ONLINE');
    status('a', 'OFFLINE');

    expect(recorded).toEqual([
      {
        type: 'device.status_changed',
        severity: EventSeverity.WARNING,
        deviceId: 'a',
        data: { from: 'ONLINE', to: 'OFFLINE' },
      },
    ]);
  });

  it('records entering and leaving FAULT, not the normal cycle', () => {
    telemetry('a', LineState.RUNNING);
    telemetry('a', LineState.RUNNING);
    telemetry('a', LineState.FAULT);
    telemetry('a', LineState.FAULT);
    telemetry('a', LineState.STOPPED);
    telemetry('a', LineState.RUNNING);

    expect(recorded.map((e) => [e.type, e.severity, e.deviceId])).toEqual([
      ['line.fault_started', EventSeverity.CRITICAL, 'a'],
      ['line.fault_cleared', EventSeverity.INFO, 'a'],
    ]);
  });

  it('forgets a removed device, so it starts over like at startup', () => {
    status('a', 'ONLINE');
    telemetry('a', LineState.RUNNING);
    realtime.publish({ type: 'device-removed', data: { deviceId: 'a' } });

    status('a', 'OFFLINE');
    telemetry('a', LineState.FAULT);

    expect(recorded).toEqual([]);
  });

  it('never throws into the publisher', () => {
    const failing = new DeviceEventRecorder(realtime, {
      record: () => {
        throw new Error('boom');
      },
    } as unknown as EventsService);
    failing.onModuleInit();
    status('x', 'ONLINE');
    expect(() => status('x', 'OFFLINE')).not.toThrow();
    failing.onModuleDestroy();
  });
});
