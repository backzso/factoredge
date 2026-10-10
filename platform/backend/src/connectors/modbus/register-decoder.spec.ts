import {
  DEFAULT_MODBUS_REGISTER_MAP,
  type RegisterMapEntry,
} from '../../devices/device-config.schema';
import {
  decodeSample,
  planReadRanges,
  type RegisterBlocks,
} from './register-decoder';

/** Golden register image of the simulator in SIM_MODE=fixed. */
function goldenInput(): number[] {
  const input = new Array<number>(20).fill(0);
  input[0] = 1883; // 123456789 = 0x075B_CD15 → ABCD words 0x075B, 0xCD15
  input[1] = 52501;
  input[2] = 0; // 72.5 = 0x4291_0000 → CDAB words 0x0000, 0x4291
  input[3] = 17041;
  input[9] = 1234; // 12.34 A at scale 0.01
  input[19] = 42;
  return input;
}

function blocks(input: number[], holding: number[]): RegisterBlocks {
  return {
    4: { start: 0, data: input },
    3: { start: 0, data: holding },
  };
}

function withEntry(
  signal: RegisterMapEntry['signal'],
  patch: Partial<RegisterMapEntry>,
): RegisterMapEntry[] {
  return DEFAULT_MODBUS_REGISTER_MAP.map((entry) =>
    entry.signal === signal ? { ...entry, ...patch } : entry,
  );
}

describe('planReadRanges', () => {
  it('reads one contiguous range per function code', () => {
    expect(planReadRanges(DEFAULT_MODBUS_REGISTER_MAP)).toEqual([
      { fc: 3, start: 0, count: 1 },
      { fc: 4, start: 0, count: 20 },
    ]);
  });

  it('includes the second word of a 32-bit value at the highest offset', () => {
    expect(
      planReadRanges([
        { fc: 4, offset: 10, type: 'uint16' },
        { fc: 4, offset: 30, type: 'float32' },
      ]),
    ).toEqual([{ fc: 4, start: 10, count: 22 }]);
  });
});

describe('decodeSample', () => {
  it('decodes the golden values', () => {
    const result = decodeSample(
      DEFAULT_MODBUS_REGISTER_MAP,
      blocks(goldenInput(), [1]),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.values.productionCount).toBe(123456789);
    expect(result.values.motorTempC).toBe(72.5);
    expect(result.values.motorCurrentA).toBeCloseTo(12.34, 10);
    expect(result.values.scrapCount).toBe(42);
    expect(result.values.state).toBe('RUNNING');
  });

  it('decodes a negative int16 current', () => {
    const input = goldenInput();
    input[9] = 64302; // two's complement of -1234

    const result = decodeSample(
      DEFAULT_MODBUS_REGISTER_MAP,
      blocks(input, [1]),
    );

    expect(result.ok && result.values.motorCurrentA).toBeCloseTo(-12.34, 10);
  });

  it('gets the temperature wrong when CDAB words are read as ABCD', () => {
    const map = withEntry('motorTempC', { wordOrder: 'ABCD' });

    const result = decodeSample(map, blocks(goldenInput(), [1]));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.values.motorTempC).not.toBeCloseTo(72.5, 1);
  });

  it('maps every state code', () => {
    const decodeState = (code: number) => {
      const result = decodeSample(
        DEFAULT_MODBUS_REGISTER_MAP,
        blocks(goldenInput(), [code]),
      );
      return result.ok ? result.values.state : result.error;
    };

    expect(decodeState(0)).toBe('STOPPED');
    expect(decodeState(1)).toBe('RUNNING');
    expect(decodeState(2)).toBe('FAULT');
  });

  it('rejects an unknown state code instead of guessing', () => {
    const result = decodeSample(
      DEFAULT_MODBUS_REGISTER_MAP,
      blocks(goldenInput(), [7]),
    );

    expect(result).toEqual({
      ok: false,
      error: 'state: unknown state code 7',
    });
  });

  it('rejects a counter that scales to a non-integer', () => {
    const map = withEntry('scrapCount', { scale: 0.5 });
    const input = goldenInput();
    input[19] = 3;

    const result = decodeSample(map, blocks(input, [1]));

    expect(result.ok).toBe(false);
  });

  it('rejects a float32 NaN', () => {
    const input = goldenInput();
    input[2] = 0x0000;
    input[3] = 0x7fc0; // quiet NaN in CDAB order

    const result = decodeSample(
      DEFAULT_MODBUS_REGISTER_MAP,
      blocks(input, [1]),
    );

    expect(result.ok).toBe(false);
  });

  it('reports registers that were not read', () => {
    const result = decodeSample(DEFAULT_MODBUS_REGISTER_MAP, {
      4: { start: 0, data: goldenInput().slice(0, 10) },
      3: { start: 0, data: [1] },
    });

    expect(result).toEqual({
      ok: false,
      error: 'scrapCount: FC4 offset 19 was not read',
    });
  });
});
