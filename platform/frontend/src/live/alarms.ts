import type { ActiveAlarm } from '../api/types';
import { formatTemperature, formatThreshold } from '../lib/format';

export interface AlarmNotice {
  title: string;
  message: string;
}

/**
 * The notification for an alarm event, or null. Only a newly raised alarm (a
 * raisedAt not seen before) notifies: a new peak of the same alarm, or the
 * same alarm repeated by a reconnect, does not.
 */
export function alarmNotice(
  deviceName: string | undefined,
  previous: ActiveAlarm | null | undefined,
  next: ActiveAlarm | null,
): AlarmNotice | null {
  if (!next || next.raisedAt === previous?.raisedAt) return null;
  return {
    title: 'Yüksek sıcaklık alarmı',
    message: `${deviceName ? `“${deviceName}” ` : ''}motor sıcaklığı ${formatTemperature(next.peakC)} (eşik ${formatThreshold(next.raiseC)}).`,
  };
}
