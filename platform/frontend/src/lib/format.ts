import type { LineState, Signal } from '../api/types';
import { lineStateLabel } from './labels';

// All number and time formatting of the UI lives here (tr-TR, local time).
// Rounding happens only here: values in the cache keep their float32 noise.

const LOCALE = 'tr-TR';
const EMPTY = '—';

const integerFormat = new Intl.NumberFormat(LOCALE, {
  maximumFractionDigits: 0,
  signDisplay: 'negative',
});
const oneDecimalFormat = new Intl.NumberFormat(LOCALE, {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
  signDisplay: 'negative',
});
const twoDecimalFormat = new Intl.NumberFormat(LOCALE, {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
  signDisplay: 'negative',
});

type MaybeNumber = number | null | undefined;

function isNumber(value: MaybeNumber): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/** Counters (production, scrap): 5821 → "5.821". */
export function formatCount(value: MaybeNumber): string {
  return isNumber(value) ? integerFormat.format(value) : EMPTY;
}

/** 63.19999 → "63,2 °C". */
export function formatTemperature(value: MaybeNumber): string {
  return isNumber(value) ? `${oneDecimalFormat.format(value)} °C` : EMPTY;
}

/** 13.8399 → "13,84 A". */
export function formatCurrent(value: MaybeNumber): string {
  return isNumber(value) ? `${twoDecimalFormat.format(value)} A` : EMPTY;
}

/** A numeric signal value, or a line state code (0/1/2) for "state". */
export function formatSignalValue(signal: Signal, value: MaybeNumber): string {
  switch (signal) {
    case 'productionCount':
    case 'scrapCount':
      return formatCount(value);
    case 'motorTempC':
      return formatTemperature(value);
    case 'motorCurrentA':
      return formatCurrent(value);
    case 'state': {
      const state = isNumber(value) ? lineStateFromCode(value) : undefined;
      return state ? lineStateLabel(state) : EMPTY;
    }
  }
}

// Codes match the line's register values: 0 STOPPED, 1 RUNNING, 2 FAULT.
const LINE_STATE_CODES: Record<LineState, number> = {
  STOPPED: 0,
  RUNNING: 1,
  FAULT: 2,
};

export function lineStateCode(state: LineState): number {
  return LINE_STATE_CODES[state];
}

export function lineStateFromCode(code: number): LineState | undefined {
  return (Object.keys(LINE_STATE_CODES) as LineState[]).find(
    (state) => LINE_STATE_CODES[state] === code,
  );
}

type TimeInput = string | number | Date | null | undefined;

function toDate(value: TimeInput): Date | undefined {
  if (value === null || value === undefined) return undefined;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

/** Local time of day: "14:05:09". */
export function formatTime(value: TimeInput): string {
  const date = toDate(value);
  return date
    ? date.toLocaleTimeString(LOCALE, {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      })
    : EMPTY;
}

/** Local time for chart ticks: "14:05". */
export function formatClock(value: TimeInput): string {
  const date = toDate(value);
  return date
    ? date.toLocaleTimeString(LOCALE, { hour: '2-digit', minute: '2-digit' })
    : EMPTY;
}

/** Local date and time: "10.10.2026 14:05". */
export function formatDateTime(value: TimeInput): string {
  const date = toDate(value);
  return date
    ? date.toLocaleString(LOCALE, {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })
    : EMPTY;
}

/**
 * "12 sn önce", "3 dk önce", "2 sa önce", "4 gün önce". A timestamp slightly in
 * the future (clock skew between server and browser) counts as "0 sn önce".
 */
export function formatRelative(value: TimeInput, now: number): string {
  const date = toDate(value);
  if (!date) return EMPTY;
  const seconds = Math.max(0, Math.floor((now - date.getTime()) / 1000));
  if (seconds < 60) return `${seconds} sn önce`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} dk önce`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} sa önce`;
  return `${Math.floor(hours / 24)} gün önce`;
}
