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
 * Raising and clearing record an event (CRITICAL / INFO). The alarm state
 * after a sample travels in that sample's `telemetry` live event (see
 * TelemetryService.ingest), so a client always gets the reading and the peak
 * it belongs to in one message. An `alarm` live event is published only when
 * the alarm changes without a sample: when it is forgotten.
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

  /** Applies one sample; returns the device's alarm after it. */
  evaluate(deviceId: string, valueC: number, now: Date): ActiveAlarm | null {
    const previous = this.alarms.get(deviceId);
    const { state, change } = evaluateAlarm(
      previous,
      valueC,
      this.thresholds,
      now,
    );
    if (state) {
      this.alarms.set(deviceId, state);
    } else {
      this.alarms.delete(deviceId);
    }

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
    return this.get(deviceId);
  }

  get(deviceId: string): ActiveAlarm | null {
    const state = this.alarms.get(deviceId);
    return state ? this.toView(state) : null;
  }

  /**
   * Drops the device's alarm without an event (connector restart, device
   * deleted). No sample carries this change, so it is published on its own.
   */
  forget(deviceId: string): void {
    if (this.alarms.delete(deviceId)) {
      this.realtime.publish({ type: 'alarm', data: { deviceId, alarm: null } });
    }
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
