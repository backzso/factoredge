// Line 1 Modbus register map. Pure functions only: no I/O, no protocol library.
//
// Document addresses use the traditional 1-based notation (3xxxx input,
// 4xxxx holding); the constants below are the 0-based protocol offsets.

import { LineSnapshot, LineState } from '../shared/line-physics';

export const INPUT_REGISTER_COUNT = 20;
export const HOLDING_REGISTER_COUNT = 1;

// Input registers (FC04)
export const PRODUCTION_COUNT_OFFSET = 0; // 30001–30002, uint32, ABCD
export const MOTOR_TEMP_OFFSET = 2; // 30003–30004, float32, CDAB
export const MOTOR_CURRENT_OFFSET = 9; // 30010, int16, scale 0.01
export const SCRAP_COUNT_OFFSET = 19; // 30020, uint16

// Holding registers (FC03 read, FC06 write)
export const STATE_OFFSET = 0; // 40001, uint16: 0 stopped, 1 running, 2 fault

export const MOTOR_CURRENT_SCALE = 0.01;

const STATE_CODES: Record<LineState, number> = {
  stopped: 0,
  running: 1,
  fault: 2,
};

export interface RegisterBank {
  input: number[];
  holding: number[];
}

/** Always returns fresh arrays so callers can swap the whole bank atomically. */
export function encodeSnapshot(snapshot: LineSnapshot): RegisterBank {
  const input = new Array<number>(INPUT_REGISTER_COUNT).fill(0);
  const holding = new Array<number>(HOLDING_REGISTER_COUNT).fill(0);

  const [productionHi, productionLo] = uint32ToWordsABCD(snapshot.productionCount);
  input[PRODUCTION_COUNT_OFFSET] = productionHi;
  input[PRODUCTION_COUNT_OFFSET + 1] = productionLo;

  const [tempFirst, tempSecond] = float32ToWordsCDAB(snapshot.motorTempC);
  input[MOTOR_TEMP_OFFSET] = tempFirst;
  input[MOTOR_TEMP_OFFSET + 1] = tempSecond;

  input[MOTOR_CURRENT_OFFSET] = scaledInt16(snapshot.motorCurrentA, MOTOR_CURRENT_SCALE);
  input[SCRAP_COUNT_OFFSET] = uint16(snapshot.scrapCount);

  holding[STATE_OFFSET] = stateToCode(snapshot.state);

  return { input, holding };
}

export function stateToCode(state: LineState): number {
  return STATE_CODES[state];
}

export function codeToState(code: number): LineState | undefined {
  const entry = Object.entries(STATE_CODES).find(([, value]) => value === code);
  return entry?.[0] as LineState | undefined;
}

/** uint32 as two words, high word first (ABCD). Wraps modulo 2^32 like a PLC counter. */
export function uint32ToWordsABCD(value: number): [number, number] {
  const wrapped = wrap(Math.trunc(value), 0x1_0000_0000);
  return [Math.floor(wrapped / 0x1_0000), wrapped % 0x1_0000];
}

/** IEEE 754 float32: big-endian bytes AB CD, then words swapped to CD AB. */
export function float32ToWordsCDAB(value: number): [number, number] {
  const view = new DataView(new ArrayBuffer(4));
  view.setFloat32(0, value, false);
  return [view.getUint16(2, false), view.getUint16(0, false)];
}

/**
 * Scaled signed 16-bit value as a two's complement word.
 * Out-of-range values are clamped to [-32768, 32767] rather than wrapped, so
 * an overload reads as the extreme value instead of a misleading small one.
 * NaN encodes as 0.
 */
export function scaledInt16(value: number, scale: number): number {
  const raw = Math.round(value / scale);
  const clamped = Math.min(32767, Math.max(-32768, raw));
  return clamped & 0xffff;
}

/** uint16 counter; wraps modulo 65536. */
export function uint16(value: number): number {
  return wrap(Math.trunc(value), 0x1_0000);
}

function wrap(value: number, modulus: number): number {
  return ((value % modulus) + modulus) % modulus;
}
