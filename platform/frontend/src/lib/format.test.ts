import { describe, expect, it } from 'vitest';
import {
  formatClock,
  formatCount,
  formatCurrent,
  formatDateTime,
  formatRelative,
  formatSignalValue,
  formatTemperature,
  formatTime,
  lineStateCode,
  lineStateFromCode,
} from './format';

describe('numbers (tr-TR)', () => {
  it('formats counters with a dot as thousands separator', () => {
    expect(formatCount(5821)).toBe('5.821');
    expect(formatCount(1234567)).toBe('1.234.567');
    expect(formatCount(0)).toBe('0');
    expect(formatCount(999)).toBe('999');
  });

  it('formats temperature with one decimal and a comma', () => {
    expect(formatTemperature(63.2)).toBe('63,2 °C');
    expect(formatTemperature(63)).toBe('63,0 °C');
    expect(formatTemperature(1063.25)).toBe('1.063,3 °C');
  });

  it('formats current with two decimals', () => {
    expect(formatCurrent(13.84)).toBe('13,84 A');
    expect(formatCurrent(0.5)).toBe('0,50 A');
  });

  it('rounds float32 noise only for display', () => {
    // float32 63.2 read back as a double
    expect(formatTemperature(63.20000076293945)).toBe('63,2 °C');
    expect(formatTemperature(63.19999694824219)).toBe('63,2 °C');
    expect(formatCurrent(13.839999675750732)).toBe('13,84 A');
  });

  it('never shows a negative zero', () => {
    expect(formatTemperature(-0.04)).toBe('0,0 °C');
    expect(formatCurrent(-0.001)).toBe('0,00 A');
    expect(formatTemperature(-1.25)).toBe('-1,3 °C');
  });

  it('shows a dash for missing values', () => {
    expect(formatCount(undefined)).toBe('—');
    expect(formatTemperature(null)).toBe('—');
    expect(formatCurrent(Number.NaN)).toBe('—');
  });

  it('formats a signal value by its kind', () => {
    expect(formatSignalValue('productionCount', 5821)).toBe('5.821');
    expect(formatSignalValue('scrapCount', 12)).toBe('12');
    expect(formatSignalValue('motorTempC', 63.2)).toBe('63,2 °C');
    expect(formatSignalValue('motorCurrentA', 13.84)).toBe('13,84 A');
    expect(formatSignalValue('state', 0)).toBe('Durdu');
    expect(formatSignalValue('state', 1)).toBe('Çalışıyor');
    expect(formatSignalValue('state', 2)).toBe('Arıza');
    expect(formatSignalValue('state', 7)).toBe('—');
  });

  it('maps line states to the register codes and back', () => {
    expect(lineStateCode('STOPPED')).toBe(0);
    expect(lineStateCode('RUNNING')).toBe(1);
    expect(lineStateCode('FAULT')).toBe(2);
    expect(lineStateFromCode(2)).toBe('FAULT');
    expect(lineStateFromCode(3)).toBeUndefined();
  });
});

describe('times (local)', () => {
  // Built from local components so the tests do not depend on the machine's time zone.
  const local = new Date(2026, 9, 10, 14, 5, 9);

  it('formats local time and date', () => {
    expect(formatTime(local)).toBe('14:05:09');
    expect(formatClock(local.getTime())).toBe('14:05');
    expect(formatDateTime(local.toISOString())).toBe('10.10.2026 14:05');
    expect(formatTime(null)).toBe('—');
    expect(formatTime('not a date')).toBe('—');
  });

  it('formats relative times', () => {
    const now = Date.parse('2026-10-10T12:00:00.000Z');
    const ago = (ms: number) => new Date(now - ms).toISOString();
    expect(formatRelative(ago(0), now)).toBe('0 sn önce');
    expect(formatRelative(ago(12_400), now)).toBe('12 sn önce');
    expect(formatRelative(ago(59_999), now)).toBe('59 sn önce');
    expect(formatRelative(ago(60_000), now)).toBe('1 dk önce');
    expect(formatRelative(ago(59 * 60_000 + 59_000), now)).toBe('59 dk önce');
    expect(formatRelative(ago(3 * 3_600_000), now)).toBe('3 sa önce');
    expect(formatRelative(ago(2 * 86_400_000), now)).toBe('2 gün önce');
  });

  it('treats a timestamp slightly in the future (clock skew) as now', () => {
    const now = Date.parse('2026-10-10T12:00:00.000Z');
    expect(formatRelative(new Date(now + 1500).toISOString(), now)).toBe('0 sn önce');
  });

  it('shows a dash without a timestamp', () => {
    expect(formatRelative(null, 0)).toBe('—');
    expect(formatRelative(undefined, 0)).toBe('—');
  });
});
