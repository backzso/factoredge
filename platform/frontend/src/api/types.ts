// Mirrors the backend contract (platform/backend/src). Keep in sync by hand:
// - users/user.select.ts            AuthUser, PublicUser
// - devices/devices.service.ts      DeviceView
// - devices/device-config.schema.ts ModbusConfig, MqttConfig, DEVICE_TEMPLATES
// - device-health/*                 DeviceHealth, DeviceStatus
// - telemetry/reading.mapper.ts     ReadingDto
// - realtime/*                      SSE events

export type Role = 'ADMIN' | 'VIEWER';
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

interface DeviceBase {
  id: string;
  name: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
  health: DeviceHealth;
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

// --- SSE (/api/stream) --------------------------------------------------------

export interface SnapshotDevice extends DeviceHealth {
  deviceId: string;
  latest: ReadingDto | null;
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

export interface HeartbeatEvent {
  type: 'heartbeat';
  data: { ts: string };
}

export type LiveEvent =
  | SnapshotEvent
  | TelemetryEvent
  | StatusEvent
  | DeviceRemovedEvent
  | HeartbeatEvent;

export const LIVE_EVENT_TYPES = [
  'snapshot',
  'telemetry',
  'status',
  'device-removed',
  'heartbeat',
] as const satisfies readonly LiveEvent['type'][];
