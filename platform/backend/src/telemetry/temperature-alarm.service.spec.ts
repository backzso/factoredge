import type { ConfigService } from '@nestjs/config';
import type { EnvironmentVariables } from '../config/env.validation';
import type { NewEvent } from '../events/event-types';
import type { EventsService } from '../events/events.service';
import { EventSeverity } from '../generated/prisma/client';
import {
  type RealtimeEvent,
  RealtimeService,
} from '../realtime/realtime.service';
import { TemperatureAlarmService } from './temperature-alarm.service';

const config = {
  get: (key: string) => (key === 'TEMP_ALARM_RAISE_C' ? 90 : 85),
} as unknown as ConfigService<EnvironmentVariables, true>;
const at = (s: number) => new Date(Date.UTC(2026, 9, 11, 10, 0, s));

describe('TemperatureAlarmService', () => {
  let recorded: NewEvent[];
  let published: RealtimeEvent[];
  let alarms: TemperatureAlarmService;

  beforeEach(() => {
    const realtime = new RealtimeService();
    published = [];
    realtime.events$.subscribe((event) => published.push(event));
    recorded = [];
    alarms = new TemperatureAlarmService(config, realtime, {
      record: (event: NewEvent) => recorded.push(event),
    } as unknown as EventsService);
  });

  it('records one CRITICAL event on raise and one INFO on clear, none for peaks', () => {
    [60, 95, 101.4, 88, 99, 84].forEach((value, i) =>
      alarms.evaluate('d1', value, at(i)),
    );

    expect(recorded).toEqual([
      {
        type: 'alarm.raised',
        severity: EventSeverity.CRITICAL,
        deviceId: 'd1',
        data: { signal: 'motorTempC', valueC: 95, raiseC: 90, clearC: 85 },
      },
      {
        type: 'alarm.cleared',
        severity: EventSeverity.INFO,
        deviceId: 'd1',
        data: {
          signal: 'motorTempC',
          valueC: 84,
          peakC: 101.4,
          clearC: 85,
          raisedAt: at(1).toISOString(),
        },
      },
    ]);
  });

  it('returns the alarm after each sample, for the telemetry event to carry; publishes nothing itself', () => {
    const after = [95, 101.4, 99, 84].map(
      (value, i) => alarms.evaluate('d1', value, at(i))?.peakC ?? null,
    );

    expect(after).toEqual([95, 101.4, 101.4, null]);
    expect(published).toEqual([]);
    expect(alarms.get('d1')).toBeNull();
  });

  it('exposes the open alarm per device', () => {
    alarms.evaluate('d1', 92, at(0));
    expect(alarms.get('d1')).toEqual({
      signal: 'motorTempC',
      raisedAt: at(0).toISOString(),
      peakC: 92,
      raiseC: 90,
      clearC: 85,
    });
    expect(alarms.get('d2')).toBeNull();
  });

  it('forgets an alarm without an event; the next hot sample opens a new one', () => {
    alarms.evaluate('d1', 95, at(0));
    alarms.forget('d1');
    expect(alarms.get('d1')).toBeNull();
    expect(published.at(-1)).toEqual({
      type: 'alarm',
      data: { deviceId: 'd1', alarm: null },
    });

    alarms.evaluate('d1', 93, at(5));
    expect(recorded.map((e) => e.type)).toEqual([
      'alarm.raised',
      'alarm.raised',
    ]);
    expect(alarms.get('d1')?.raisedAt).toBe(at(5).toISOString());
  });
});
