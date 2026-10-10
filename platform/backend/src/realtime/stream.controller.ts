import { Controller, type MessageEvent, Sse } from '@nestjs/common';
import {
  concat,
  defer,
  interval,
  map,
  merge,
  Observable,
  of,
  takeUntil,
} from 'rxjs';
import { DeviceHealthService } from '../device-health/device-health.service';
import { TelemetryService } from '../telemetry/telemetry.service';
import { RealtimeService } from './realtime.service';

// The frontend treats 15 s without any event as a dead connection (a proxy can
// keep a stream open after the backend is gone), so heartbeats must be well
// inside that: three per window.
const HEARTBEAT_INTERVAL_MS = 5_000;

/**
 * Server-Sent Events for any logged-in user (global JwtAuthGuard, cookie or Bearer).
 *
 * Event types: snapshot (first), then telemetry, status, device-removed, and a
 * heartbeat every 5 s: it keeps proxies from closing an idle stream and lets the
 * client detect a dead connection by silence.
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
    // On shutdown the stream completes, Nest ends the response, and the HTTP
    // server can close; the browser's EventSource then reconnects to the next
    // instance.
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
    ).pipe(takeUntil(this.realtime.closing$));
  }

  private snapshot(): MessageEvent {
    const devices = this.health.snapshot().map((health) => ({
      ...health,
      latest: this.telemetry.latest(health.deviceId) ?? null,
    }));
    return { type: 'snapshot', data: { devices } };
  }
}
