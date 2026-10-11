// Motor temperature alarm with hysteresis. Pure: the caller keeps the state
// and passes the clock in.

export interface AlarmThresholds {
  /** Raised when a value is at or above this. */
  raiseC: number;
  /** Cleared only when a value is at or below this (lower than raiseC). */
  clearC: number;
}

/** An open alarm; no alarm is `undefined`. */
export interface AlarmState {
  raisedAt: Date;
  /** Highest value seen while open. */
  peakC: number;
}

export type AlarmChange = 'raised' | 'cleared' | 'peak' | null;

export interface AlarmEvaluation {
  state: AlarmState | undefined;
  change: AlarmChange;
}

/**
 * Two thresholds instead of one: a value wandering around 90 °C would
 * otherwise open and close the alarm on every sample. Between clearC and
 * raiseC the alarm keeps whatever state it had.
 */
export function evaluateAlarm(
  state: AlarmState | undefined,
  valueC: number,
  thresholds: AlarmThresholds,
  now: Date,
): AlarmEvaluation {
  if (!Number.isFinite(valueC)) return { state, change: null };
  if (!state) {
    return valueC >= thresholds.raiseC
      ? { state: { raisedAt: now, peakC: valueC }, change: 'raised' }
      : { state, change: null };
  }
  if (valueC <= thresholds.clearC)
    return { state: undefined, change: 'cleared' };
  if (valueC > state.peakC) {
    return { state: { ...state, peakC: valueC }, change: 'peak' };
  }
  return { state, change: null };
}
