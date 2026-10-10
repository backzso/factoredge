import { z } from 'zod';
import type { LineState } from '../../generated/prisma/client';
import type { TelemetrySample } from '../connector.types';

const STATES: Record<'running' | 'stopped' | 'fault', LineState> = {
  running: 'RUNNING',
  stopped: 'STOPPED',
  fault: 'FAULT',
};

const counter = z.int().min(0);

/** Payload published on <prefix>/telemetry by the Line 2 simulator. */
export const telemetryPayloadSchema = z.object({
  ts: z.iso.datetime({ offset: true }),
  seq: z.int().min(0),
  state: z.enum(['running', 'stopped', 'fault']),
  productionCount: counter,
  motorTempC: z.number(),
  motorCurrentA: z.number(),
  scrapCount: counter,
});

export type TelemetryPayload = z.infer<typeof telemetryPayloadSchema>;

export function payloadToSample(payload: TelemetryPayload): TelemetrySample {
  return {
    ts: new Date(payload.ts),
    productionCount: payload.productionCount,
    scrapCount: payload.scrapCount,
    motorTempC: payload.motorTempC,
    motorCurrentA: payload.motorCurrentA,
    state: STATES[payload.state],
  };
}
