import { describe, expect, it } from 'vitest';
import type { ActiveAlarm } from '../api/types';
import { alarmNotice } from './alarms';

const alarm = (raisedAt: string, peakC = 90.4): ActiveAlarm => ({
  signal: 'motorTempC',
  raisedAt,
  peakC,
  raiseC: 90,
  clearC: 85,
});

describe('alarmNotice', () => {
  it('notifies a newly raised alarm', () => {
    expect(alarmNotice('Bant 1', null, alarm('t1'))).toEqual({
      title: 'Yüksek sıcaklık alarmı',
      message: '“Bant 1” motor sıcaklığı 90,4 °C (eşik 90 °C).',
    });
    expect(alarmNotice(undefined, undefined, alarm('t1'))?.message).toBe(
      'motor sıcaklığı 90,4 °C (eşik 90 °C).',
    );
  });

  it('does not notify the same alarm again: new peak, or repeated after a reconnect', () => {
    expect(alarmNotice('Bant 1', alarm('t1'), alarm('t1', 101.4))).toBeNull();
    expect(alarmNotice('Bant 1', alarm('t1'), alarm('t1'))).toBeNull();
  });

  it('notifies a new alarm after the previous one, and never a clear', () => {
    expect(alarmNotice('Bant 1', alarm('t1'), alarm('t2'))).not.toBeNull();
    expect(alarmNotice('Bant 1', alarm('t1'), null)).toBeNull();
  });
});
