import type { EventDto, KnownEvent, Severity } from '../../api/types';
import { formatTemperature, formatThreshold } from '../../lib/format';
import { HEALTH, LINE_STATE, PROTOCOL, ROLE_LABEL } from '../../lib/labels';

// The one place where an event (type + data) becomes Turkish text. The backend
// stores no display text; a type it adds later shows the fallback until it is
// added here.

export const SEVERITY: Record<Severity, { label: string; color: string }> = {
  INFO: { label: 'Bilgi', color: 'blue' },
  WARNING: { label: 'Uyarı', color: 'yellow' },
  CRITICAL: { label: 'Kritik', color: 'red' },
};

/** Names are quoted, so no Turkish suffix has to agree with them. */
function quoted(value: unknown): string {
  return `“${typeof value === 'string' && value ? value : '?'}”`;
}

/** A label from a table, or the raw value if the table does not know it. */
function labelOf<K extends string>(
  table: Record<K, string | { label: string }>,
  key: unknown,
): string {
  const entry = typeof key === 'string' ? table[key as K] : undefined;
  if (entry === undefined) return String(key ?? '?');
  return typeof entry === 'string' ? entry : entry.label;
}

function actorOf(data: Record<string, unknown>): string {
  return typeof data.actorUsername === 'string' ? data.actorUsername : 'Bir kullanıcı';
}

/** The sentence of an event, e.g. `“Bant 1” arızaya geçti.` */
export function describeEvent(event: EventDto): string {
  const known = event as KnownEvent;
  const actor = actorOf(event.data);
  switch (known.type) {
    case 'device.created':
      return `${actor}, ${quoted(known.data.deviceName)} cihazını ekledi (${labelOf(PROTOCOL, known.data.protocol)}).`;
    case 'device.updated':
      return `${actor}, ${quoted(known.data.deviceName)} cihazını düzenledi: ${deviceChanges(known.data)}.`;
    case 'device.deleted':
      return `${actor}, ${quoted(known.data.deviceName)} cihazını sildi.`;
    case 'device.status_changed':
      return statusSentence(quoted(known.data.deviceName), known.data.from, known.data.to);
    case 'line.fault_started':
      return `${quoted(known.data.deviceName)} arızaya geçti.`;
    case 'line.fault_cleared':
      return `${quoted(known.data.deviceName)} arızadan çıktı (${labelOf(LINE_STATE, known.data.state)}).`;
    case 'alarm.raised':
      return `${quoted(known.data.deviceName)} yüksek motor sıcaklığı: ${formatTemperature(known.data.valueC)} (eşik ${formatThreshold(known.data.raiseC)}).`;
    case 'alarm.cleared':
      return `${quoted(known.data.deviceName)} sıcaklık alarmı kapandı: ${formatTemperature(known.data.valueC)} (tepe ${formatTemperature(known.data.peakC)}).`;
    case 'user.created':
      return `${actor}, ${quoted(known.data.targetUsername)} kullanıcısını ekledi (${labelOf(ROLE_LABEL, known.data.role)}).`;
    case 'user.role_changed':
      return `${actor}, ${quoted(known.data.targetUsername)} kullanıcısının rolünü değiştirdi: ${labelOf(ROLE_LABEL, known.data.previousRole)} → ${labelOf(ROLE_LABEL, known.data.role)}.`;
    case 'user.password_reset':
      return `${actor}, ${quoted(known.data.targetUsername)} kullanıcısının parolasını sıfırladı.`;
    case 'user.deleted':
      return `${actor}, ${quoted(known.data.targetUsername)} kullanıcısını sildi.`;
    default:
      return `Tanınmayan olay: ${event.type}`;
  }
}

function deviceChanges(data: Extract<KnownEvent, { type: 'device.updated' }>['data']): string {
  const parts: string[] = [];
  for (const change of data.changes ?? []) {
    if (change === 'name') parts.push(`ad ${quoted(data.previousName)} → ${quoted(data.deviceName)}`);
    if (change === 'enabled') parts.push(data.enabled ? 'etkinleştirildi' : 'devre dışı bırakıldı');
    if (change === 'config') parts.push('bağlantı ayarları değişti');
  }
  return parts.length > 0 ? parts.join(', ') : 'ayarlar değişti';
}

function statusSentence(device: string, from: unknown, to: unknown): string {
  switch (to) {
    case 'ONLINE':
      return `${device} geri geldi (${HEALTH.ONLINE.label}).`;
    case 'OFFLINE':
      return `${device} bağlantısı koptu (${HEALTH.OFFLINE.label}).`;
    case 'STALE':
      return `${device} veri göndermiyor (${HEALTH.STALE.label}).`;
    case 'DISABLED':
      return `${device} devre dışı.`;
    default:
      return `${device} durumu değişti: ${labelOf(HEALTH, from)} → ${labelOf(HEALTH, to)}.`;
  }
}

/** Technical detail shown under the sentence (connection error), if any. */
export function eventDetail(event: EventDto): string | null {
  return event.type === 'device.status_changed' && typeof event.data.error === 'string'
    ? event.data.error
    : null;
}

/**
 * The device column: the name as it was when the event happened. `deleted` when
 * the event was about a device that no longer exists (its id was cleared).
 */
export function eventDevice(event: EventDto): { name: string; deleted: boolean } | null {
  const name = event.data.deviceName;
  if (typeof name !== 'string') return null;
  return { name, deleted: event.deviceId === null };
}
