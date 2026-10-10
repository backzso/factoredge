import { Controller, type MessageEvent, Sse } from '@nestjs/common';
import { concat, defer, interval, map, merge, Observable, of } from 'rxjs';
import { DeviceHealthService } from '../device-health/device-health.service';
import { TelemetryService } from '../telemetry/telemetry.service';
import { RealtimeService } from './realtime.service';

const HEARTBEAT_INTERVAL_MS = 15_000;

/**
 * Server-Sent Events for any logged-in user (global JwtAuthGuard, cookie or Bearer).
 *
 * Event types: snapshot (first), then telemetry, status, device-removed, and a
 * heartbeat every 15 s so proxies and the browser keep the connection open.
 */
@Controller()
export class StreamController {
  constructor(
    private readonly realtime: RealtimeService,
    private readonly telemetry: TelemetryService,
    private readonly health: DeviceHealthService,
  ) {}

  @Sse('stream')
  stream(): Observable<MessageEvent> {
    // The snapshot is built and the live subscription opened in the same
    // synchronous step, so no event can fall between the two. Nest unsubscribes
    // when the client disconnects, which removes the subscriber from the Subject.
    return defer(() =>
      concat(
        of(this.snapshot()),
        merge(
          this.realtime.events$,
          interval(HEARTBEAT_INTERVAL_MS).pipe(
            map((): MessageEvent => ({
              type: 'heartbeat',
              data: { ts: new Date().toISOString() },
            })),
          ),
        ),
      ),
    );
  }

  private snapshot(): MessageEvent {
    const devices = this.health.snapshot().map((health) => ({
      ...health,
      latest: this.telemetry.latest(health.deviceId) ?? null,
    }));
    return { type: 'snapshot', data: { devices } };
  }
}
