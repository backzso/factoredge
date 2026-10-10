import type { ConnectionEvent } from '../connectors/connector.types';

export type ConnectionState = ConnectionEvent['type'];

/**
 * DISABLED is decided by DeviceHealthService (no connector runs for a disabled
 * device); deriveStatus only covers devices whose connector is running.
 */
export type DeviceStatus =
  'CONNECTING' | 'ONLINE' | 'STALE' | 'OFFLINE' | 'DISABLED';

export interface StatusInput {
  connection: ConnectionState;
  connectedAt?: Date;
  lastSeenAt?: Date;
  staleAfterMs: number;
  /** The status derived last time; undefined for a freshly started connector. */
  previousStatus?: DeviceStatus;
}

/**
 * - connecting → CONNECTING, disconnected → OFFLINE
 * - connecting while OFFLINE stays OFFLINE: retry attempts must not make the
 *   status flap OFFLINE ↔ CONNECTING. Only 'connected' leaves OFFLINE. The
 *   CONNECTING of a freshly started connector is unaffected.
 * - connected: fresh data → ONLINE; no fresh data yet but connected recently →
 *   CONNECTING (grace period for the first sample); otherwise STALE.
 */
export function deriveStatus(
  input: StatusInput,
  now: Date,
): Exclude<DeviceStatus, 'DISABLED'> {
  switch (input.connection) {
    case 'connecting':
      return input.previousStatus === 'OFFLINE' ? 'OFFLINE' : 'CONNECTING';
    case 'disconnected':
      return 'OFFLINE';
    case 'connected': {
      const nowMs = now.getTime();
      if (
        input.lastSeenAt &&
        nowMs - input.lastSeenAt.getTime() <= input.staleAfterMs
      ) {
        return 'ONLINE';
      }
      if (
        input.connectedAt &&
        nowMs - input.connectedAt.getTime() <= input.staleAfterMs
      ) {
        return 'CONNECTING';
      }
      return 'STALE';
    }
  }
}
