import { Controller, type MessageEvent, Req, Sse } from '@nestjs/common';
import {
  concat,
  defer,
  interval,
  map,
  merge,
  Observable,
  of,
  takeUntil,
  takeWhile,
} from 'rxjs';
import type { AuthenticatedRequest } from '../auth/auth.types';
import { CurrentUser } from '../auth/current-user.decorator';
import { DeviceHealthService } from '../device-health/device-health.service';
import { TelemetryService } from '../telemetry/telemetry.service';
import type { AuthUser } from '../users/user.select';
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
 *
 * Session events go to the streams of one user only: session-changed (role or
 * password changed) and session-ended, after which the stream completes. A
 * session ends when the user is deleted (announced by the users service, or
 * found by SessionWatchService's 30 s check) or when the token expires (checked
 * with each heartbeat, so at most 5 s late).
 */
@Controller()
export class StreamController {
  constructor(
    private readonly realtime: RealtimeService,
    private readonly telemetry: TelemetryService,
    private readonly health: DeviceHealthService,
  ) {}

  @Sse('stream')
  stream(
    @CurrentUser() user: AuthUser,
    @Req() request: AuthenticatedRequest,
  ): Observable<MessageEvent> {
    const expiresAt = request.tokenExpiresAt;
    // The snapshot is built and the live subscription opened in the same
    // synchronous step, so no event can fall between the two. Nest unsubscribes
    // when the client disconnects, which removes the subscriber from the Subject
    // and the stream from its user's session registrations.
    // On shutdown the stream completes, Nest ends the response, and the HTTP
    // server can close; the browser's EventSource then reconnects to the next
    // instance.
    return defer(() =>
      concat(
        of(this.snapshot()),
        merge(
          this.realtime.events$,
          this.realtime.sessionEvents(user.id),
          interval(HEARTBEAT_INTERVAL_MS).pipe(
            map((): MessageEvent =>
              expiresAt !== undefined && Date.now() >= expiresAt
                ? { type: 'session-ended', data: { reason: 'expired' } }
                : { type: 'heartbeat', data: { ts: new Date().toISOString() } },
            ),
          ),
        ),
      ),
    ).pipe(
      // session-ended is the last event: sent, then the stream completes.
      takeWhile((event) => event.type !== 'session-ended', true),
      takeUntil(this.realtime.closing$),
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
