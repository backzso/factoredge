import type { DeviceStatus } from '../device-health/derive-status';
import { EventSeverity, LineState } from '../generated/prisma/client';
import type { NewEvent } from './event-types';

// Which live changes become events. Pure: no clock, no I/O.

const DOWN: ReadonlySet<DeviceStatus> = new Set(['STALE', 'OFFLINE']);

export interface HealthTransition {
  /** The new last non-CONNECTING status, to pass in next time. */
  settled: DeviceStatus | undefined;
  event: NewEvent<'device.status_changed'> | null;
}

/**
 * `settled` is the device's last status other than CONNECTING. CONNECTING is
 * never recorded and does not move `settled`, so a reconnect
 * OFFLINE → CONNECTING → ONLINE reads as "back online", and a connector restart
 * ONLINE → CONNECTING → ONLINE as nothing at all.
 *
 * - first status after startup (settled undefined): nothing (startup noise)
 * - ONLINE → STALE / OFFLINE: WARNING
 * - STALE / OFFLINE → ONLINE: INFO ("back")
 * - STALE → OFFLINE and the like: nothing, the device was already down
 * - anything → DISABLED: INFO. Leaving DISABLED is not recorded here: the
 *   device.updated event of the re-enable already says it.
 */
export function healthTransition(
  settled: DeviceStatus | undefined,
  next: DeviceStatus,
  error: string | null,
): HealthTransition {
  if (next === 'CONNECTING') return { settled, event: null };
  if (settled === undefined || settled === next) {
    return { settled: next, event: null };
  }

  let severity: EventSeverity | null = null;
  if (next === 'DISABLED') {
    severity = EventSeverity.INFO;
  } else if (next === 'ONLINE' && DOWN.has(settled)) {
    severity = EventSeverity.INFO;
  } else if (DOWN.has(next) && settled === 'ONLINE') {
    severity = EventSeverity.WARNING;
  }

  return {
    settled: next,
    event: severity && {
      type: 'device.status_changed',
      severity,
      data: {
        from: settled,
        to: next,
        ...(DOWN.has(next) && error ? { error } : {}),
      },
    },
  };
}

export type LineEvent = NewEvent<'line.fault_started' | 'line.fault_cleared'>;

/**
 * Entering FAULT is CRITICAL, leaving it INFO. The normal RUNNING ↔ STOPPED
 * cycle is not recorded, nor is the first sample (no previous state).
 */
export function lineStateTransition(
  previous: LineState | undefined,
  next: LineState,
): LineEvent | null {
  if (previous === undefined || previous === next) return null;
  if (next === LineState.FAULT) {
    return {
      type: 'line.fault_started',
      severity: EventSeverity.CRITICAL,
      data: { previousState: previous },
    };
  }
  if (previous === LineState.FAULT) {
    return {
      type: 'line.fault_cleared',
      severity: EventSeverity.INFO,
      data: { state: next },
    };
  }
  return null;
}
