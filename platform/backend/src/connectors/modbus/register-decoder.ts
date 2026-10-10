import type {
  RegisterMapEntry,
  RegisterType,
} from '../../devices/device-config.schema';
import type { LineState } from '../../generated/prisma/client';
import type { TelemetrySample } from '../connector.types';

// Pure decoding of Modbus register words into a telemetry sample.
// Written independently from the simulator's encoder on purpose: sharing code
// would let an encoding bug cancel itself out in the tests.

export type FunctionCode = 3 | 4;

export interface ReadRange {
  fc: FunctionCode;
  start: number;
  count: number;
}

/** Words returned by one read per function code, starting at `start`. */
export type RegisterBlocks = Partial<
  Record<FunctionCode, { start: number; data: readonly number[] }>
>;

export type DecodedValues = Omit<TelemetrySample, 'ts'>;

export type DecodeResult =
  { ok: true; values: DecodedValues } | { ok: false; error: string };

const STATE_CODES: ReadonlyMap<number, LineState> = new Map([
  [0, 'STOPPED'],
  [1, 'RUNNING'],
  [2, 'FAULT'],
]);

export function registerWidth(type: RegisterType): 1 | 2 {
  return type === 'uint32' || type === 'float32' ? 2 : 1;
}

/**
 * One contiguous range per function code, from the lowest offset to the end of
 * the highest register, so each poll is a single request per function code.
 */
export function planReadRanges(
  map: readonly Pick<RegisterMapEntry, 'fc' | 'offset' | 'type'>[],
): ReadRange[] {
  const bounds = new Map<FunctionCode, { start: number; end: number }>();
  for (const entry of map) {
    const end = entry.offset + registerWidth(entry.type);
    const current = bounds.get(entry.fc);
    bounds.set(entry.fc, {
      start: Math.min(current?.start ?? entry.offset, entry.offset),
      end: Math.max(current?.end ?? end, end),
    });
  }
  return [...bounds.entries()]
    .sort(([a], [b]) => a - b)
    .map(([fc, { start, end }]) => ({ fc, start, count: end - start }));
}

/**
 * Decodes every mapped signal. Returns an error instead of a sample when a
 * value is unusable (unknown state code, non-integer counter, NaN, missing words).
 */
export function decodeSample(
  map: readonly RegisterMapEntry[],
  blocks: RegisterBlocks,
): DecodeResult {
  const values: Partial<Record<RegisterMapEntry['signal'], number>> = {};

  for (const entry of map) {
    const block = blocks[entry.fc];
    const width = registerWidth(entry.type);
    const index = block ? entry.offset - block.start : -1;
    if (!block || index < 0 || index + width > block.data.length) {
      return {
        ok: false,
        error: `${entry.signal}: FC${entry.fc} offset ${entry.offset} was not read`,
      };
    }
    const words = block.data.slice(index, index + width);
    values[entry.signal] = decodeRaw(entry, words) * entry.scale;
  }

  const {
    productionCount,
    scrapCount,
    motorTempC,
    motorCurrentA,
    state: stateCode,
  } = values;

  const state =
    stateCode === undefined ? undefined : STATE_CODES.get(stateCode);
  if (state === undefined) {
    return { ok: false, error: `state: unknown state code ${stateCode}` };
  }
  for (const [name, value] of [
    ['productionCount', productionCount],
    ['scrapCount', scrapCount],
  ] as const) {
    if (value === undefined || !Number.isSafeInteger(value) || value < 0) {
      return {
        ok: false,
        error: `${name}: ${value} is not a non-negative integer`,
      };
    }
  }
  for (const [name, value] of [
    ['motorTempC', motorTempC],
    ['motorCurrentA', motorCurrentA],
  ] as const) {
    if (value === undefined || !Number.isFinite(value)) {
      return { ok: false, error: `${name}: ${value} is not a finite number` };
    }
  }

  return {
    ok: true,
    values: {
      productionCount: productionCount!,
      scrapCount: scrapCount!,
      motorTempC: motorTempC!,
      motorCurrentA: motorCurrentA!,
      state,
    },
  };
}

function decodeRaw(entry: RegisterMapEntry, words: readonly number[]): number {
  switch (entry.type) {
    case 'uint16':
      return words[0];
    case 'int16':
      return words[0] >= 0x8000 ? words[0] - 0x1_0000 : words[0];
    case 'uint32': {
      const [high, low] = orderWords(entry, words);
      return high * 0x1_0000 + low;
    }
    case 'float32': {
      const [high, low] = orderWords(entry, words);
      const view = new DataView(new ArrayBuffer(4));
      view.setUint16(0, high, false);
      view.setUint16(2, low, false);
      return view.getFloat32(0, false);
    }
  }
}

/** Returns [high word, low word]. ABCD: high word first; CDAB: low word first. */
function orderWords(
  entry: RegisterMapEntry,
  words: readonly number[],
): [number, number] {
  return entry.wordOrder === 'CDAB'
    ? [words[1], words[0]]
    : [words[0], words[1]];
}
