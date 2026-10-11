// Mirrors the backend contract (platform/backend/src). Keep in sync by hand:
// - users/user.select.ts            AuthUser, PublicUser
// - devices/devices.service.ts      DeviceView
// - devices/device-config.schema.ts ModbusConfig, MqttConfig, DEVICE_TEMPLATES
// - device-health/*                 DeviceHealth, DeviceStatus
// - telemetry/reading.mapper.ts     ReadingDto
// - telemetry/temperature-alarm.service.ts ActiveAlarm
// - realtime/*                      SSE events
// - events/event-types.ts           EventDto and the data of each event type

export type Role = 'ADMIN' | 'ENGINEER' | 'VIEWER';
export type Protocol = 'MODBUS' | 'MQTT';
export type LineState = 'RUNNING' | 'STOPPED' | 'FAULT';
export type HealthStatus =
  | 'CONNECTING'
  | 'ONLINE'
  | 'STALE'
  | 'OFFLINE'
  | 'DISABLED';

export interface AuthUser {
  id: string;
  username: string;
  role: Role;
}

export interface PublicUser extends AuthUser {
  createdAt: string;
  updatedAt: string;
}

export const SIGNALS = [
  'productionCount',
  'motorTempC',
  'motorCurrentA',
  'scrapCount',
  'state',
] as const;
export type Signal = (typeof SIGNALS)[number];

export const REGISTER_TYPES = ['uint16', 'int16', 'uint32', 'float32'] as const;
export type RegisterType = (typeof REGISTER_TYPES)[number];
export type WordOrder = 'ABCD' | 'CDAB';
export type FunctionCode = 3 | 4;

export interface RegisterMapEntry {
  signal: Signal;
  fc: FunctionCode;
  offset: number;
  type: RegisterType;
  wordOrder?: WordOrder;
  scale: number;
}

export interface ModbusConfig {
  host: string;
  port: number;
  unitId: number;
  pollIntervalMs: number;
  timeoutMs: number;
  registerMap: RegisterMapEntry[];
}

export interface MqttConfig {
  brokerUrl: string;
  topicPrefix: string;
  staleAfterMs: number;
}

export interface DeviceTemplates {
  MODBUS: Omit<ModbusConfig, 'host'>;
  MQTT: Omit<MqttConfig, 'brokerUrl'>;
}

export interface DeviceHealth {
  status: HealthStatus;
  /** When the platform last received a sample (ISO). */
  lastSeenAt: string | null;
  lastError: string | null;
}

/** An open motor temperature alarm (hysteresis: raised at raiseC, cleared at clearC). */
export interface ActiveAlarm {
  signal: 'motorTempC';
  /** When it was raised (ISO). */
  raisedAt: string;
  /** Highest value since then. */
  peakC: number;
  raiseC: number;
  clearC: number;
}

interface DeviceBase {
  id: string;
  name: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
  health: DeviceHealth;
  alarm: ActiveAlarm | null;
}

export type Device =
  | (DeviceBase & { protocol: 'MODBUS'; config: ModbusConfig })
  | (DeviceBase & { protocol: 'MQTT'; config: MqttConfig });

export interface ReadingDto {
  /** When the value was measured on the line (ISO). */
  ts: string;
  /** When the platform received it (ISO). */
  receivedAt: string;
  productionCount: number;
  scrapCount: number;
  motorTempC: number;
  motorCurrentA: number;
  state: LineState;
}

/** Last reading per device id. */
export type LatestReadings = Record<string, ReadingDto>;

export interface ValidationIssue {
  /** e.g. "config.registerMap[3].offset"; empty for the root value. */
  path: string;
  message: string;
}

// --- Event log (/api/events) -------------------------------------------------

export type Severity = 'INFO' | 'WARNING' | 'CRITICAL';
export type DeviceChange = 'name' | 'enabled' | 'config';

/** data of each event type: the context copied when it happened. */
export interface EventDataMap {
  'device.created': { deviceName: string; protocol: Protocol; actorUsername: string };
  'device.updated': {
    deviceName: string;
    previousName?: string;
    changes: DeviceChange[];
    enabled: boolean;
    actorUsername: string;
  };
  'device.deleted': { deviceName: string; protocol: Protocol; actorUsername: string };
  'device.status_changed': {
    deviceName: string;
    from: HealthStatus;
    to: HealthStatus;
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

export type KnownEventType = keyof EventDataMap;

interface EventBase {
  id: string;
  ts: string;
  severity: Severity;
  /** null for events not about a device, and once the device is deleted. */
  deviceId: string | null;
}

/** An event of a type this client knows, narrowed by `type`. */
export type KnownEvent = {
  [K in KnownEventType]: EventBase & { type: K; data: EventDataMap[K] };
}[KnownEventType];

/** As served: a newer backend may send types this client does not know. */
export type EventDto = EventBase & { type: string; data: Record<string, unknown> };

export interface EventPage {
  items: EventDto[];
  /** `before` of the next (older) page; null on the last one. */
  nextCursor: string | null;
}

// --- SSE (/api/stream) --------------------------------------------------------

export interface SnapshotDevice extends DeviceHealth {
  deviceId: string;
  latest: ReadingDto | null;
  alarm: ActiveAlarm | null;
}

export interface SnapshotEvent {
  type: 'snapshot';
  data: { devices: SnapshotDevice[] };
}

export interface TelemetryEvent {
  type: 'telemetry';
  data: { deviceId: string; reading: ReadingDto };
}

export interface StatusEvent {
  type: 'status';
  data: { deviceId: string } & DeviceHealth;
}

export interface DeviceRemovedEvent {
  type: 'device-removed';
  data: { deviceId: string };
}

/** A temperature alarm opened, reached a new peak, or closed (alarm: null). */
export interface AlarmEvent {
  type: 'alarm';
  data: { deviceId: string; alarm: ActiveAlarm | null };
}

/** A new entry of the event log (already filtered by role on the server). */
export interface EventLogEvent {
  type: 'event';
  data: EventDto;
}

export interface HeartbeatEvent {
  type: 'heartbeat';
  data: { ts: string };
}

export type LiveEvent =
  | SnapshotEvent
  | TelemetryEvent
  | StatusEvent
  | DeviceRemovedEvent
  | AlarmEvent
  | EventLogEvent
  | HeartbeatEvent;

// Sent only to the streams of the user they concern.

export interface SessionEndedEvent {
  type: 'session-ended';
  /** deleted: the user was removed; expired: the token ran out. The stream then ends. */
  data: { reason: 'deleted' | 'expired' };
}

export interface SessionChangedEvent {
  type: 'session-changed';
  data: { changes: Array<'role' | 'password'>; role?: Role };
}

export type SessionEvent = SessionEndedEvent | SessionChangedEvent;

export const SESSION_EVENT_TYPES = [
  'session-ended',
  'session-changed',
] as const satisfies readonly SessionEvent['type'][];

export const LIVE_EVENT_TYPES = [
  'snapshot',
  'telemetry',
  'status',
  'device-removed',
  'alarm',
  'event',
  'heartbeat',
] as const satisfies readonly LiveEvent['type'][];
