import { type ReadingRow, toReadingDto, toSafeNumber } from './reading.mapper';

const row = (overrides: Partial<ReadingRow> = {}): ReadingRow => ({
  ts: new Date('2026-10-08T12:00:00.123Z'),
  receivedAt: new Date('2026-10-08T12:00:00.150Z'),
  productionCount: 123456789n,
  scrapCount: 42n,
  motorTempC: 72.5,
  motorCurrentA: -12.34,
  state: 'RUNNING',
  ...overrides,
});

describe('toReadingDto', () => {
  it('converts BigInt counters to numbers and dates to ISO strings', () => {
    const dto = toReadingDto(row());

    expect(dto).toEqual({
      ts: '2026-10-08T12:00:00.123Z',
      receivedAt: '2026-10-08T12:00:00.150Z',
      productionCount: 123456789,
      scrapCount: 42,
      motorTempC: 72.5,
      motorCurrentA: -12.34,
      state: 'RUNNING',
    });
    // The whole point: the result must be JSON-serializable.
    expect(() => JSON.stringify(dto)).not.toThrow();
  });

  it('keeps a uint32 counter at its maximum exact', () => {
    expect(
      toReadingDto(row({ productionCount: 4294967295n })).productionCount,
    ).toBe(4294967295);
  });

  it('accepts Number.MAX_SAFE_INTEGER', () => {
    expect(
      toReadingDto(row({ scrapCount: BigInt(Number.MAX_SAFE_INTEGER) }))
        .scrapCount,
    ).toBe(Number.MAX_SAFE_INTEGER);
  });

  it('throws above Number.MAX_SAFE_INTEGER instead of losing precision', () => {
    expect(() =>
      toReadingDto(
        row({ productionCount: BigInt(Number.MAX_SAFE_INTEGER) + 1n }),
      ),
    ).toThrow(RangeError);
  });
});

describe('toSafeNumber', () => {
  it('names the field in the error', () => {
    expect(() => toSafeNumber(2n ** 60n, 'scrapCount')).toThrow(/scrapCount/);
  });
});
