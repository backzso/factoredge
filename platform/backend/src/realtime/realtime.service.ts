import { Injectable } from '@nestjs/common';
import { Observable, Subject } from 'rxjs';
import type { DeviceHealth } from '../device-health/device-health.service';
import type { ReadingDto } from '../telemetry/reading.mapper';

// Shaped like Nest's MessageEvent: `type` becomes the SSE "event:" field, so the
// browser can listen with addEventListener(type).
export type RealtimeEvent =
  | { type: 'telemetry'; data: { deviceId: string; reading: ReadingDto } }
  | { type: 'status'; data: { deviceId: string } & DeviceHealth }
  | { type: 'device-removed'; data: { deviceId: string } };

/**
 * In-process event bus for live updates. Publishers (telemetry, device health,
 * connector manager) push events; every open SSE stream subscribes.
 */
@Injectable()
export class RealtimeService {
  private readonly subject = new Subject<RealtimeEvent>();

  readonly events$: Observable<RealtimeEvent> = this.subject.asObservable();

  publish(event: RealtimeEvent): void {
    this.subject.next(event);
  }
}
