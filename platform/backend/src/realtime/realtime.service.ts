import { BeforeApplicationShutdown, Injectable } from '@nestjs/common';
import { Observable, ReplaySubject, Subject, type Subscriber } from 'rxjs';
import type { DeviceHealth } from '../device-health/device-health.service';
import type { ReadingDto } from '../telemetry/reading.mapper';

// Shaped like Nest's MessageEvent: `type` becomes the SSE "event:" field, so the
// browser can listen with addEventListener(type).
export type RealtimeEvent =
  | { type: 'telemetry'; data: { deviceId: string; reading: ReadingDto } }
  | { type: 'status'; data: { deviceId: string } & DeviceHealth }
  | { type: 'device-removed'; data: { deviceId: string } };

export type SessionEndReason = 'deleted' | 'expired';
export type SessionChange = 'role' | 'password';

/**
 * Sent only to the streams of one user. After session-ended the stream
 * completes; session-changed tells the client to reload who it is.
 */
export type SessionEvent =
  | { type: 'session-ended'; data: { reason: SessionEndReason } }
  | { type: 'session-changed'; data: { changes: SessionChange[] } };

/**
 * In-process event bus for live updates. Publishers (telemetry, device health,
 * connector manager) push events; every open SSE stream subscribes.
 *
 * Session events are targeted instead: each stream registers under its user id
 * while open, and the users service addresses a user's streams by that id.
 */
@Injectable()
export class RealtimeService implements BeforeApplicationShutdown {
  private readonly subject = new Subject<RealtimeEvent>();
  // Replayed, so a stream opened after shutdown began ends right away too.
  private readonly closing = new ReplaySubject<void>(1);
  private readonly sessionStreams = new Map<
    string,
    Set<Subscriber<SessionEvent>>
  >();

  readonly events$: Observable<RealtimeEvent> = this.subject.asObservable();

  /**
   * Emits once when the application starts shutting down. Live streams end on
   * it: an open SSE response would otherwise keep the HTTP server from closing.
   */
  readonly closing$: Observable<void> = this.closing.asObservable();

  publish(event: RealtimeEvent): void {
    this.subject.next(event);
  }

  /**
   * Session events for one stream of `userId`. The stream is registered while
   * subscribed and removed when it ends or the client disconnects.
   */
  sessionEvents(userId: string): Observable<SessionEvent> {
    return new Observable<SessionEvent>((subscriber) => {
      const streams = this.sessionStreams.get(userId) ?? new Set();
      streams.add(subscriber);
      this.sessionStreams.set(userId, streams);
      return () => {
        streams.delete(subscriber);
        if (streams.size === 0 && this.sessionStreams.get(userId) === streams) {
          this.sessionStreams.delete(userId);
        }
      };
    });
  }

  /** Users with at least one open stream. */
  connectedUserIds(): string[] {
    return [...this.sessionStreams.keys()];
  }

  /** Ends every open stream of the user with a session-ended event. */
  endSessions(userId: string, reason: SessionEndReason): void {
    this.sendToUser(userId, { type: 'session-ended', data: { reason } });
  }

  /** Tells every open stream of the user that its role or password changed. */
  sessionChanged(userId: string, changes: SessionChange[]): void {
    this.sendToUser(userId, { type: 'session-changed', data: { changes } });
  }

  /** Runs before Nest closes the HTTP server, which waits for open responses. */
  beforeApplicationShutdown(): void {
    this.closing.next();
    this.closing.complete();
  }

  private sendToUser(userId: string, event: SessionEvent): void {
    // Copied: a stream that ends on this event unregisters while we iterate.
    for (const subscriber of [...(this.sessionStreams.get(userId) ?? [])]) {
      subscriber.next(event);
    }
  }
}
