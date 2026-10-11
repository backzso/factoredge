import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { EnvironmentVariables } from '../config/env.validation';
import { EventsService } from '../events/events.service';
import { EventSeverity } from '../generated/prisma/client';
import { RealtimeService } from '../realtime/realtime.service';
import {
  type AlarmState,
  type AlarmThresholds,
  evaluateAlarm,
} from './temperature-alarm';

/** An open alarm as exposed by the API, the snapshot and the live stream. */
export interface ActiveAlarm {
  signal: 'motorTempC';
  raisedAt: string;
  peakC: number;
  raiseC: number;
  clearC: number;
}

/**
 * Motor temperature alarm per device, evaluated on every sample the platform
 * ingests (not in the connectors). State is in memory only: it is forgotten
 * when the device's connector is restarted or the device is deleted, and after
 * a backend restart it is rebuilt from the incoming samples.
 *
 * Raising and clearing record an event (CRITICAL / INFO) and publish an
 * `alarm` live event; a new peak only publishes.
 */
@Injectable()
export class TemperatureAlarmService {
  private readonly alarms = new Map<string, AlarmState>();
  readonly thresholds: AlarmThresholds;

  constructor(
    config: ConfigService<EnvironmentVariables, true>,
    private readonly realtime: RealtimeService,
    private readonly events: EventsService,
  ) {
    this.thresholds = {
      raiseC: config.get('TEMP_ALARM_RAISE_C', { infer: true }),
      clearC: config.get('TEMP_ALARM_CLEAR_C', { infer: true }),
    };
  }

  evaluate(deviceId: string, valueC: number, now: Date): void {
    const previous = this.alarms.get(deviceId);
    const { state, change } = evaluateAlarm(
      previous,
      valueC,
      this.thresholds,
      now,
    );
    if (!change) return;

    if (state) {
      this.alarms.set(deviceId, state);
    } else {
      this.alarms.delete(deviceId);
    }
    this.publish(deviceId);

    const { raiseC, clearC } = this.thresholds;
    if (change === 'raised') {
      this.events.record({
        type: 'alarm.raised',
        severity: EventSeverity.CRITICAL,
        deviceId,
        data: { signal: 'motorTempC', valueC, raiseC, clearC },
      });
    } else if (change === 'cleared' && previous) {
      this.events.record({
        type: 'alarm.cleared',
        severity: EventSeverity.INFO,
        deviceId,
        data: {
          signal: 'motorTempC',
          valueC,
          peakC: previous.peakC,
          clearC,
          raisedAt: previous.raisedAt.toISOString(),
        },
      });
    }
  }

  get(deviceId: string): ActiveAlarm | null {
    const state = this.alarms.get(deviceId);
    return state ? this.toView(state) : null;
  }

  /** Drops the device's alarm without an event (connector restart, device deleted). */
  forget(deviceId: string): void {
    if (this.alarms.delete(deviceId)) {
      this.publish(deviceId);
    }
  }

  private publish(deviceId: string): void {
    this.realtime.publish({
      type: 'alarm',
      data: { deviceId, alarm: this.get(deviceId) },
    });
  }

  private toView(state: AlarmState): ActiveAlarm {
    return {
      signal: 'motorTempC',
      raisedAt: state.raisedAt.toISOString(),
      peakC: state.peakC,
      raiseC: this.thresholds.raiseC,
      clearC: this.thresholds.clearC,
    };
  }
}
