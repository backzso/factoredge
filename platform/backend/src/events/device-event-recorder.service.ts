import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import type { Subscription } from 'rxjs';
import { errorMessage } from '../common/error-message';
import type { DeviceStatus } from '../device-health/derive-status';
import type { LineState } from '../generated/prisma/client';
import {
  type RealtimeEvent,
  RealtimeService,
} from '../realtime/realtime.service';
import { healthTransition, lineStateTransition } from './event-rules';
import { EventsService } from './events.service';

/**
 * Turns live changes into events by listening to the realtime bus: status
 * events (device health) and telemetry (line state). Device health, telemetry
 * and the connectors do not know that events exist.
 *
 * Per device it remembers the last settled health status and line state;
 * both are forgotten when the device is removed. After a backend restart they
 * start empty, so the first status and sample of each device are not recorded.
 */
@Injectable()
export class DeviceEventRecorder implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DeviceEventRecorder.name);
  private readonly settled = new Map<string, DeviceStatus>();
  private readonly lineStates = new Map<string, LineState>();
  private subscription: Subscription | undefined;

  constructor(
    private readonly realtime: RealtimeService,
    private readonly events: EventsService,
  ) {}

  onModuleInit(): void {
    this.subscription = this.realtime.events$.subscribe((event) => {
      // Runs inside publish(): never let a bug here reach the publisher.
      try {
        this.handle(event);
      } catch (error) {
        this.logger.error(`event rules failed: ${errorMessage(error)}`);
      }
    });
  }

  onModuleDestroy(): void {
    this.subscription?.unsubscribe();
  }

  handle(event: RealtimeEvent): void {
    switch (event.type) {
      case 'status': {
        const { deviceId, status, lastError } = event.data;
        const result = healthTransition(
          this.settled.get(deviceId),
          status,
          lastError,
        );
        if (result.settled === undefined) {
          this.settled.delete(deviceId);
        } else {
          this.settled.set(deviceId, result.settled);
        }
        if (result.event) {
          this.events.record({ ...result.event, deviceId });
        }
        return;
      }
      case 'telemetry': {
        const { deviceId, reading } = event.data;
        const lineEvent = lineStateTransition(
          this.lineStates.get(deviceId),
          reading.state,
        );
        this.lineStates.set(deviceId, reading.state);
        if (lineEvent) {
          this.events.record({ ...lineEvent, deviceId });
        }
        return;
      }
      case 'device-removed':
        this.settled.delete(event.data.deviceId);
        this.lineStates.delete(event.data.deviceId);
        return;
      default:
        return;
    }
  }
}
