import type {
  Device,
  DeviceRemovedEvent,
  LatestReadings,
  ReadingDto,
  SnapshotEvent,
  StatusEvent,
  TelemetryEvent,
} from '../api/types';

// Pure cache updates for live (SSE) events. No QueryClient, no clock: `now`
// is passed in. An undefined cache (query not loaded yet) is returned as is;
// the REST response that fills it later is already up to date.

type Devices = Device[] | undefined;
type Latest = LatestReadings | undefined;
type Readings = ReadingDto[] | undefined;

export interface DevicesUpdate {
  devices: Devices;
  /** The event named a device the loaded list does not have: refetch the list. */
  unknown: boolean;
}

/** Seeds the health of every listed device; reports devices the list is missing. */
export function applySnapshotToDevices(
  devices: Devices,
  event: SnapshotEvent,
): DevicesUpdate {
  if (!devices) return { devices, unknown: false };
  const byId = new Map(event.data.devices.map((d) => [d.deviceId, d]));
  const known = new Set(devices.map((d) => d.id));
  const next = devices.map((device) => {
    const live = byId.get(device.id);
    if (!live) return device;
    return {
      ...device,
      health: {
        status: live.status,
        lastSeenAt: live.lastSeenAt,
        lastError: live.lastError,
      },
    };
  });
  const unknown = event.data.devices.some((d) => !known.has(d.deviceId));
  return { devices: next, unknown };
}

/**
 * The snapshot decides which devices exist. A device whose connector was
 * restarted has `latest: null`; its previous reading is kept so the dashboard
 * can still show the last known values (dimmed).
 */
export function applySnapshotToLatest(
  latest: Latest,
  event: SnapshotEvent,
): LatestReadings {
  const next: LatestReadings = {};
  for (const device of event.data.devices) {
    const reading = device.latest ?? latest?.[device.deviceId];
    if (reading) {
      next[device.deviceId] = reading;
    }
  }
  return next;
}

export function applyTelemetryToLatest(
  latest: Latest,
  event: TelemetryEvent,
): LatestReadings {
  return { ...latest, [event.data.deviceId]: event.data.reading };
}

/**
 * Status events are only sent when the status changes, so lastSeenAt is
 * advanced from every sample (the backend sets it to the sample's receivedAt).
 */
export function applyTelemetryToDevices(
  devices: Devices,
  event: TelemetryEvent,
): DevicesUpdate {
  const { deviceId, reading } = event.data;
  return updateDevice(devices, deviceId, (device) =>
    device.health.lastSeenAt === reading.receivedAt
      ? device
      : { ...device, health: { ...device.health, lastSeenAt: reading.receivedAt } },
  );
}

export function applyStatusToDevices(
  devices: Devices,
  event: StatusEvent,
): DevicesUpdate {
  const { deviceId, status, lastSeenAt, lastError } = event.data;
  return updateDevice(devices, deviceId, (device) => ({
    ...device,
    health: { status, lastSeenAt, lastError },
  }));
}

export function removeDeviceFromDevices(
  devices: Devices,
  event: DeviceRemovedEvent,
): Devices {
  if (!devices) return devices;
  const next = devices.filter((d) => d.id !== event.data.deviceId);
  return next.length === devices.length ? devices : next;
}

export function removeDeviceFromLatest(
  latest: Latest,
  event: DeviceRemovedEvent,
): Latest {
  if (!latest || !(event.data.deviceId in latest)) return latest;
  const next = { ...latest };
  delete next[event.data.deviceId];
  return next;
}

/**
 * Appends a live reading to a loaded history (oldest first) and drops readings
 * older than the window. A reading not newer than the last one (re-sent sample,
 * or already part of the REST response) is ignored.
 */
export function appendReading(
  readings: Readings,
  reading: ReadingDto,
  now: number,
  windowMinutes: number,
): Readings {
  if (!readings) return readings;
  const ts = Date.parse(reading.ts);
  const last = readings.at(-1);
  const base = last && Date.parse(last.ts) >= ts ? readings : [...readings, reading];
  return trimReadings(base, now, windowMinutes);
}

/** Drops readings measured before now - window; returns the same array if nothing changed. */
export function trimReadings(
  readings: ReadingDto[],
  now: number,
  windowMinutes: number,
): ReadingDto[] {
  const since = now - windowMinutes * 60_000;
  const firstKept = readings.findIndex((r) => Date.parse(r.ts) >= since);
  if (firstKept === 0) return readings;
  return firstKept === -1 ? [] : readings.slice(firstKept);
}

function updateDevice(
  devices: Devices,
  deviceId: string,
  update: (device: Device) => Device,
): DevicesUpdate {
  if (!devices) return { devices, unknown: false };
  const index = devices.findIndex((d) => d.id === deviceId);
  if (index === -1) return { devices, unknown: true };
  const current = devices[index]!;
  const updated = update(current);
  if (updated === current) return { devices, unknown: false };
  const next = [...devices];
  next[index] = updated;
  return { devices: next, unknown: false };
}
