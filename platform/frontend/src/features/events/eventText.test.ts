import { describe, expect, it } from 'vitest';
import type { EventDto, Severity } from '../../api/types';
import { describeEvent, eventDetail, eventDevice, SEVERITY } from './eventText';

function event(
  type: string,
  data: Record<string, unknown>,
  deviceId: string | null = 'd1',
  severity: Severity = 'INFO',
): EventDto {
  return { id: 'e1', ts: '2026-10-11T10:00:00.000Z', type, severity, deviceId, data };
}

describe('describeEvent', () => {
  it.each([
    [
      'device.created',
      { deviceName: 'Bant 1', protocol: 'MODBUS', actorUsername: 'admin' },
      'admin, “Bant 1” cihazını ekledi (Modbus TCP).',
    ],
    [
      'device.updated',
      {
        deviceName: 'Bant 1b',
        previousName: 'Bant 1',
        changes: ['name', 'enabled', 'config'],
        enabled: false,
        actorUsername: 'muhendis',
      },
      'muhendis, “Bant 1b” cihazını düzenledi: ad “Bant 1” → “Bant 1b”, devre dışı bırakıldı, bağlantı ayarları değişti.',
    ],
    [
      'device.updated',
      { deviceName: 'Bant 2', changes: ['enabled'], enabled: true, actorUsername: 'admin' },
      'admin, “Bant 2” cihazını düzenledi: etkinleştirildi.',
    ],
    [
      'device.deleted',
      { deviceName: 'Bant 2', protocol: 'MQTT', actorUsername: 'admin' },
      'admin, “Bant 2” cihazını sildi.',
    ],
    [
      'device.status_changed',
      { deviceName: 'Bant 1', from: 'ONLINE', to: 'OFFLINE', error: 'ECONNREFUSED' },
      '“Bant 1” bağlantısı koptu (Bağlantı yok).',
    ],
    [
      'device.status_changed',
      { deviceName: 'Bant 2', from: 'ONLINE', to: 'STALE' },
      '“Bant 2” veri göndermiyor (Veri yok).',
    ],
    [
      'device.status_changed',
      { deviceName: 'Bant 1', from: 'OFFLINE', to: 'ONLINE' },
      '“Bant 1” geri geldi (Çevrimiçi).',
    ],
    [
      'device.status_changed',
      { deviceName: 'Bant 1', from: 'ONLINE', to: 'DISABLED' },
      '“Bant 1” devre dışı.',
    ],
    ['line.fault_started', { deviceName: 'Bant 1', previousState: 'RUNNING' }, '“Bant 1” arızaya geçti.'],
    [
      'line.fault_cleared',
      { deviceName: 'Bant 1', state: 'STOPPED' },
      '“Bant 1” arızadan çıktı (Durdu).',
    ],
    [
      'alarm.raised',
      { deviceName: 'Bant 1', signal: 'motorTempC', valueC: 90.43, raiseC: 90, clearC: 85 },
      '“Bant 1” yüksek motor sıcaklığı: 90,4 °C (eşik 90 °C).',
    ],
    [
      'alarm.cleared',
      {
        deviceName: 'Bant 1',
        signal: 'motorTempC',
        valueC: 84.92,
        peakC: 108.18,
        clearC: 85,
        raisedAt: '2026-10-11T10:00:00.000Z',
      },
      '“Bant 1” sıcaklık alarmı kapandı: 84,9 °C (tepe 108,2 °C).',
    ],
    [
      'user.created',
      { targetUsername: 'ayse', role: 'ENGINEER', actorUsername: 'admin' },
      'admin, “ayse” kullanıcısını ekledi (Mühendis).',
    ],
    [
      'user.role_changed',
      { targetUsername: 'ayse', previousRole: 'VIEWER', role: 'ENGINEER', actorUsername: 'admin' },
      'admin, “ayse” kullanıcısının rolünü değiştirdi: İzleyici → Mühendis.',
    ],
    [
      'user.password_reset',
      { targetUsername: 'ayse', actorUsername: 'admin' },
      'admin, “ayse” kullanıcısının parolasını sıfırladı.',
    ],
    [
      'user.deleted',
      { targetUsername: 'ayse', role: 'VIEWER', actorUsername: 'admin' },
      'admin, “ayse” kullanıcısını sildi.',
    ],
  ])('%s → Turkish sentence', (type, data, sentence) => {
    expect(describeEvent(event(type, data))).toBe(sentence);
  });

  it('falls back for unknown types and missing or unknown values', () => {
    expect(describeEvent(event('line.speed_changed', {}))).toBe('Tanınmayan olay: line.speed_changed');
    expect(describeEvent(event('user.created', { targetUsername: 'x', role: 'OWNER' }))).toBe(
      'Bir kullanıcı, “x” kullanıcısını ekledi (OWNER).',
    );
    expect(describeEvent(event('line.fault_started', {}))).toBe('“?” arızaya geçti.');
  });
});

describe('event helpers', () => {
  it('labels every severity', () => {
    expect(SEVERITY.INFO.label).toBe('Bilgi');
    expect(SEVERITY.WARNING.label).toBe('Uyarı');
    expect(SEVERITY.CRITICAL.label).toBe('Kritik');
  });

  it('keeps the device name of a deleted device and marks it', () => {
    expect(eventDevice(event('device.created', { deviceName: 'Bant 1' }))).toEqual({
      name: 'Bant 1',
      deleted: false,
    });
    expect(eventDevice(event('device.created', { deviceName: 'Bant 1' }, null))).toEqual({
      name: 'Bant 1',
      deleted: true,
    });
    expect(eventDevice(event('user.created', { targetUsername: 'x' }, null))).toBeNull();
  });

  it('shows the connection error as detail', () => {
    expect(
      eventDetail(event('device.status_changed', { from: 'ONLINE', to: 'OFFLINE', error: 'timeout' })),
    ).toBe('timeout');
    expect(eventDetail(event('device.created', { error: 'x' }))).toBeNull();
  });
});
