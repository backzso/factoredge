import { z } from 'zod';
import {
  planReadRanges,
  registerWidth,
} from '../connectors/modbus/register-decoder';
import { Protocol } from '../generated/prisma/client';

// Device config arrives as free-form JSON (HTTP body, devices.config column),
// so it is validated at runtime with zod. Objects are strict: a typo such as
// "pollInteval" is rejected instead of silently falling back to a default.

export const SIGNALS = [
  'productionCount',
  'motorTempC',
  'motorCurrentA',
  'scrapCount',
  'state',
] as const;

export const REGISTER_TYPES = ['uint16', 'int16', 'uint32', 'float32'] as const;
export type RegisterType = (typeof REGISTER_TYPES)[number];

/** Modbus limit for a single read holding/input registers request. */
export const MAX_REGISTERS_PER_READ = 125;

const registerMapEntrySchema = z
  .strictObject({
    signal: z.enum(SIGNALS),
    fc: z.literal([3, 4]),
    offset: z.int().min(0).max(65535),
    type: z.enum(REGISTER_TYPES),
    wordOrder: z.enum(['ABCD', 'CDAB']).optional(),
    scale: z.number().positive().default(1),
  })
  .superRefine((entry, ctx) => {
    const width = registerWidth(entry.type);
    // No default word order for 32-bit values: guessing ABCD silently corrupts CDAB floats.
    if (width === 2 && entry.wordOrder === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['wordOrder'],
        message: `wordOrder (ABCD or CDAB) is required for ${entry.type}`,
      });
    }
    if (width === 1 && entry.wordOrder !== undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['wordOrder'],
        message: 'wordOrder is only allowed for 32-bit types',
      });
    }
    if (entry.offset + width - 1 > 65535) {
      ctx.addIssue({
        code: 'custom',
        path: ['offset'],
        message: `${entry.type} at offset ${entry.offset} runs past register 65535`,
      });
    }
    // State is a code (0/1/2), not a measurement: scaling or signedness makes no sense.
    if (
      entry.signal === 'state' &&
      (entry.type !== 'uint16' || entry.scale !== 1)
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['type'],
        message: 'state must be uint16 with scale 1',
      });
    }
  });

const registerMapSchema = z
  .array(registerMapEntrySchema)
  .superRefine((map, ctx) => {
    for (const signal of SIGNALS) {
      const indexes = map.flatMap((entry, index) =>
        entry.signal === signal ? [index] : [],
      );
      if (indexes.length === 0) {
        ctx.addIssue({
          code: 'custom',
          path: [],
          message: `signal "${signal}" is missing`,
        });
      }
      for (const index of indexes.slice(1)) {
        ctx.addIssue({
          code: 'custom',
          path: [index, 'signal'],
          message: `signal "${signal}" appears more than once`,
        });
      }
    }
    for (const range of planReadRanges(map)) {
      if (range.count > MAX_REGISTERS_PER_READ) {
        ctx.addIssue({
          code: 'custom',
          path: [],
          message:
            `FC${range.fc} offsets ${range.start}..${range.start + range.count - 1} ` +
            `span ${range.count} registers; one request can read at most ${MAX_REGISTERS_PER_READ}`,
        });
      }
    }
  });

export const modbusConfigSchema = z.strictObject({
  host: z.union([z.ipv4(), z.hostname()], {
    error: 'host must be an IPv4 address or a hostname',
  }),
  port: z.int().min(1).max(65535),
  unitId: z.int().min(1).max(247),
  pollIntervalMs: z.int().min(200).max(3_600_000).default(1000),
  timeoutMs: z.int().min(100).max(60_000).default(1000),
  registerMap: registerMapSchema,
});

export const mqttConfigSchema = z.strictObject({
  brokerUrl: z
    .string()
    .trim()
    .refine((value) => isMqttUrl(value), {
      error: 'brokerUrl must be a valid URL starting with mqtt://',
    }),
  topicPrefix: z
    .string()
    .trim()
    .min(1)
    .max(200)
    .refine((value) => !/[#+\0]/.test(value), {
      error: 'topicPrefix must not contain MQTT wildcards (+, #)',
    })
    .refine((value) => !value.endsWith('/'), {
      error: 'topicPrefix must not end with "/"',
    }),
  staleAfterMs: z.int().min(500).max(3_600_000).default(3000),
});

export const deviceConfigSchema = z.discriminatedUnion('protocol', [
  z.object({
    protocol: z.literal(Protocol.MODBUS),
    config: modbusConfigSchema,
  }),
  z.object({ protocol: z.literal(Protocol.MQTT), config: mqttConfigSchema }),
]);

export type DeviceConfig = z.infer<typeof deviceConfigSchema>;
export type ModbusConfig = z.infer<typeof modbusConfigSchema>;
export type MqttConfig = z.infer<typeof mqttConfigSchema>;
export type RegisterMapEntry = z.infer<typeof registerMapEntrySchema>;

/**
 * Validates the config for a protocol and fills in defaults.
 * Throws a ZodError; issue paths start with "config".
 */
export function parseDeviceConfig(
  protocol: Protocol,
  config: unknown,
): DeviceConfig {
  return deviceConfigSchema.parse({ protocol, config });
}

function isMqttUrl(value: string): boolean {
  if (!value.startsWith('mqtt://')) {
    return false;
  }
  try {
    return new URL(value).hostname !== '';
  } catch {
    return false;
  }
}

/** Line 1 register map from the case document. */
export const DEFAULT_MODBUS_REGISTER_MAP: RegisterMapEntry[] = [
  {
    signal: 'productionCount',
    fc: 4,
    offset: 0,
    type: 'uint32',
    wordOrder: 'ABCD',
    scale: 1,
  },
  {
    signal: 'motorTempC',
    fc: 4,
    offset: 2,
    type: 'float32',
    wordOrder: 'CDAB',
    scale: 1,
  },
  { signal: 'motorCurrentA', fc: 4, offset: 9, type: 'int16', scale: 0.01 },
  { signal: 'scrapCount', fc: 4, offset: 19, type: 'uint16', scale: 1 },
  // 0 STOPPED, 1 RUNNING, 2 FAULT
  { signal: 'state', fc: 3, offset: 0, type: 'uint16', scale: 1 },
];

/**
 * Pre-fills the "add device" form. Environment-specific fields (host, brokerUrl)
 * are left out on purpose.
 */
export const DEVICE_TEMPLATES = {
  [Protocol.MODBUS]: {
    // 5020 is the port given in the case document (Line 1 simulator), not the IANA default 502.
    port: 5020,
    unitId: 1,
    pollIntervalMs: 1000,
    timeoutMs: 1000,
    registerMap: DEFAULT_MODBUS_REGISTER_MAP,
  },
  [Protocol.MQTT]: {
    // Topic prefix from the case document (Line 2 simulator).
    topicPrefix: 'factory/line2',
    staleAfterMs: 3000,
  },
} satisfies {
  [Protocol.MODBUS]: Omit<ModbusConfig, 'host'>;
  [Protocol.MQTT]: Omit<MqttConfig, 'brokerUrl'>;
};
