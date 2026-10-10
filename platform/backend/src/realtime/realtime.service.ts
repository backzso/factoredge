import { BeforeApplicationShutdown, Injectable } from '@nestjs/common';
import { Observable, ReplaySubject, Subject } from 'rxjs';
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
export class RealtimeService implements BeforeApplicationShutdown {
  private readonly subject = new Subject<RealtimeEvent>();
  // Replayed, so a stream opened after shutdown began ends right away too.
  private readonly closing = new ReplaySubject<void>(1);

  readonly events$: Observable<RealtimeEvent> = this.subject.asObservable();

  /**
   * Emits once when the application starts shutting down. Live streams end on
   * it: an open SSE response would otherwise keep the HTTP server from closing.
   */
  readonly closing$: Observable<void> = this.closing.asObservable();

  publish(event: RealtimeEvent): void {
    this.subject.next(event);
  }

  /** Runs before Nest closes the HTTP server, which waits for open responses. */
  beforeApplicationShutdown(): void {
    this.closing.next();
    this.closing.complete();
  }
}
