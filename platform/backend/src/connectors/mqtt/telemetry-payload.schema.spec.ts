import {
  payloadToSample,
  telemetryPayloadSchema,
} from './telemetry-payload.schema';

/** As published by the Line 2 simulator. */
const SIMULATOR_PAYLOAD = {
  ts: '2026-10-08T12:00:00.123Z',
  seq: 42,
  state: 'running',
  productionCount: 1500,
  motorTempC: 71.25,
  motorCurrentA: 12.4,
  scrapCount: 7,
};

describe('telemetry payload schema', () => {
  it('accepts the simulator payload and maps it to a sample', () => {
    const parsed = telemetryPayloadSchema.parse(SIMULATOR_PAYLOAD);

    expect(payloadToSample(parsed)).toEqual({
      ts: new Date('2026-10-08T12:00:00.123Z'),
      productionCount: 1500,
      scrapCount: 7,
      motorTempC: 71.25,
      motorCurrentA: 12.4,
      state: 'RUNNING',
    });
  });

  it.each([
    ['stopped', 'STOPPED'],
    ['fault', 'FAULT'],
  ])('maps state %s to %s', (state, expected) => {
    const parsed = telemetryPayloadSchema.parse({
      ...SIMULATOR_PAYLOAD,
      state,
    });
    expect(payloadToSample(parsed).state).toBe(expected);
  });

  it('accepts a timestamp with an explicit offset', () => {
    const result = telemetryPayloadSchema.safeParse({
      ...SIMULATOR_PAYLOAD,
      ts: '2026-10-08T15:00:00+03:00',
    });
    expect(result.success).toBe(true);
  });

  it.each([
    ['a missing field', { ...SIMULATOR_PAYLOAD, motorTempC: undefined }],
    ['an unknown state', { ...SIMULATOR_PAYLOAD, state: 'idle' }],
    ['a negative counter', { ...SIMULATOR_PAYLOAD, scrapCount: -1 }],
    ['a fractional counter', { ...SIMULATOR_PAYLOAD, productionCount: 1.5 }],
    ['a malformed timestamp', { ...SIMULATOR_PAYLOAD, ts: 'yesterday' }],
    ['a numeric string', { ...SIMULATOR_PAYLOAD, motorCurrentA: '12.4' }],
    ['a non-object', 'running'],
  ])('rejects %s', (_label, payload) => {
    expect(telemetryPayloadSchema.safeParse(payload).success).toBe(false);
  });
});
