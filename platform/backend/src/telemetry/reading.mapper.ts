import type { LineState, Reading } from '../generated/prisma/client';

/** A reading as it leaves the API (REST history, SSE snapshot and live events). */
export interface ReadingDto {
  ts: string;
  receivedAt: string;
  productionCount: number;
  scrapCount: number;
  motorTempC: number;
  motorCurrentA: number;
  state: LineState;
}

export type ReadingRow = Pick<
  Reading,
  | 'ts'
  | 'receivedAt'
  | 'productionCount'
  | 'scrapCount'
  | 'motorTempC'
  | 'motorCurrentA'
  | 'state'
>;

/** The only way readings are turned into API output: BigInt never reaches JSON.stringify. */
export function toReadingDto(row: ReadingRow): ReadingDto {
  return {
    ts: row.ts.toISOString(),
    receivedAt: row.receivedAt.toISOString(),
    productionCount: toSafeNumber(row.productionCount, 'productionCount'),
    scrapCount: toSafeNumber(row.scrapCount, 'scrapCount'),
    motorTempC: row.motorTempC,
    motorCurrentA: row.motorCurrentA,
    state: row.state,
  };
}

/** Throws instead of silently losing precision above 2^53 - 1. */
export function toSafeNumber(value: bigint, field: string): number {
  if (
    value > BigInt(Number.MAX_SAFE_INTEGER) ||
    value < BigInt(Number.MIN_SAFE_INTEGER)
  ) {
    throw new RangeError(
      `${field} ${value} is outside the safe integer range of a JSON number`,
    );
  }
  return Number(value);
}
