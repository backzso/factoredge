import type { DeviceStatus } from '../device-health/derive-status';
import {
  type EventSeverity,
  type LineState,
  type Protocol,
  Role,
} from '../generated/prisma/client';
import type { AuthUser } from '../users/user.select';

// Events are stored as type + data, never as display text: the frontend builds
// the (Turkish) sentence. `data` copies the context of the moment (device name,
// usernames, values), so an event keeps its meaning after a rename or delete.

export type DeviceChange = 'name' | 'enabled' | 'config';

export interface EventDataMap {
  'device.created': {
    deviceName: string;
    protocol: Protocol;
    actorUsername: string;
  };
  'device.updated': {
    deviceName: string;
    /** Only when the name changed. */
    previousName?: string;
    changes: DeviceChange[];
    enabled: boolean;
    actorUsername: string;
  };
  'device.deleted': {
    deviceName: string;
    protocol: Protocol;
    actorUsername: string;
  };
  'device.status_changed': {
    deviceName: string;
    from: DeviceStatus;
    to: DeviceStatus;
    error?: string;
  };
  'line.fault_started': { deviceName: string; previousState: LineState };
  'line.fault_cleared': { deviceName: string; state: LineState };
  'alarm.raised': {
    deviceName: string;
    signal: 'motorTempC';
    valueC: number;
    raiseC: number;
    clearC: number;
  };
  'alarm.cleared': {
    deviceName: string;
    signal: 'motorTempC';
    valueC: number;
    peakC: number;
    clearC: number;
    raisedAt: string;
  };
  'user.created': { targetUsername: string; role: Role; actorUsername: string };
  'user.role_changed': {
    targetUsername: string;
    previousRole: Role;
    role: Role;
    actorUsername: string;
  };
  'user.password_reset': { targetUsername: string; actorUsername: string };
  'user.deleted': { targetUsername: string; role: Role; actorUsername: string };
}

export type EventType = keyof EventDataMap;

type WithOptional<T, K extends PropertyKey> = Omit<T, K & keyof T> &
  Partial<Pick<T, K & keyof T>>;

/** What callers hand to EventsService.record(); a union over the event types. */
export type NewEvent<T extends EventType = EventType> = {
  [K in T]: {
    type: K;
    severity: EventSeverity;
    /** The device the event is about. */
    deviceId?: string | null;
    /** Who did it; stored as userId and copied as data.actorUsername. */
    actor?: AuthUser;
    /** deviceName is looked up from deviceId when not given. */
    data: WithOptional<EventDataMap[K], 'deviceName' | 'actorUsername'>;
  };
}[T];

/** An event as served by GET /api/events and the live stream. */
export interface EventDto {
  id: string;
  ts: string;
  type: string;
  severity: EventSeverity;
  /** null for events not about a device, or once the device is deleted. */
  deviceId: string | null;
  data: Record<string, unknown>;
}

export const USER_EVENT_PREFIX = 'user.';

/** user.* events (who manages whom) are for admins only; the rest is for everyone. */
export function canSeeEvent(role: Role, type: string): boolean {
  return role === Role.ADMIN || !type.startsWith(USER_EVENT_PREFIX);
}

/**
 * English one-liner for the log and the message column. Not shown in the UI;
 * it only has to be readable in a terminal or psql.
 */
export function describeEventEn(
  type: string,
  data: Record<string, unknown>,
): string {
  const text = (value: unknown) => (typeof value === 'string' ? value : '?');
  const device = `"${text(data.deviceName)}"`;
  const actor = text(data.actorUsername);
  const target = `"${text(data.targetUsername)}"`;
  switch (type) {
    case 'device.created':
      return `${actor} created device ${device}`;
    case 'device.updated':
      return `${actor} updated device ${device} (${(data.changes as string[] | undefined)?.join(', ') ?? ''})`;
    case 'device.deleted':
      return `${actor} deleted device ${device}`;
    case 'device.status_changed':
      return `${device} ${String(data.from)} -> ${String(data.to)}`;
    case 'line.fault_started':
      return `${device} entered FAULT`;
    case 'line.fault_cleared':
      return `${device} left FAULT (${String(data.state)})`;
    case 'alarm.raised':
      return `${device} motor temperature alarm: ${String(data.valueC)} C >= ${String(data.raiseC)} C`;
    case 'alarm.cleared':
      return `${device} motor temperature alarm cleared: ${String(data.valueC)} C <= ${String(data.clearC)} C (peak ${String(data.peakC)} C)`;
    case 'user.created':
      return `${actor} created user ${target} (${String(data.role)})`;
    case 'user.role_changed':
      return `${actor} changed the role of ${target}: ${String(data.previousRole)} -> ${String(data.role)}`;
    case 'user.password_reset':
      return `${actor} reset the password of ${target}`;
    case 'user.deleted':
      return `${actor} deleted user ${target}`;
    default:
      return type;
  }
}
