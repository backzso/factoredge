import { ZodError } from 'zod';
import { formatZodIssues } from '../common/zod-issues';
import { Protocol } from '../generated/prisma/client';
import {
  DEFAULT_MODBUS_REGISTER_MAP,
  DEVICE_TEMPLATES,
  parseDeviceConfig,
} from './device-config.schema';

const modbus = (overrides: Record<string, unknown> = {}) => ({
  ...DEVICE_TEMPLATES.MODBUS,
  host: '192.168.252.2',
  ...overrides,
});

const mqtt = (overrides: Record<string, unknown> = {}) => ({
  ...DEVICE_TEMPLATES.MQTT,
  brokerUrl: 'mqtt://192.168.252.2:1883',
  ...overrides,
});

/** Returns the formatted issues, or fails if the config is valid. */
function issuesOf(protocol: Protocol, config: unknown) {
  try {
    parseDeviceConfig(protocol, config);
  } catch (error) {
    if (error instanceof ZodError) return formatZodIssues(error);
    throw error;
  }
  throw new Error('expected the config to be rejected');
}

describe('device config schema', () => {
  describe('MODBUS', () => {
    it('accepts the template plus a host and fills in defaults', () => {
      const parsed = parseDeviceConfig(Protocol.MODBUS, {
        host: 'line1.local',
        port: 5020,
        unitId: 1,
        registerMap: DEFAULT_MODBUS_REGISTER_MAP.map((entry) => {
          const rest: Record<string, unknown> = { ...entry };
          delete rest.scale;
          return rest;
        }),
      });

      expect(parsed.protocol).toBe(Protocol.MODBUS);
      if (parsed.protocol !== Protocol.MODBUS) return;
      expect(parsed.config.pollIntervalMs).toBe(1000);
      expect(parsed.config.timeoutMs).toBe(1000);
      expect(parsed.config.registerMap.every((e) => e.scale === 1)).toBe(true);
      expect(() => parseDeviceConfig(Protocol.MODBUS, modbus())).not.toThrow();
    });

    it('rejects a missing signal', () => {
      const config = modbus({
        registerMap: DEFAULT_MODBUS_REGISTER_MAP.filter(
          (e) => e.signal !== 'scrapCount',
        ),
      });

      expect(issuesOf(Protocol.MODBUS, config)).toEqual([
        {
          path: 'config.registerMap',
          message: 'signal "scrapCount" is missing',
        },
      ]);
    });

    it('rejects a duplicated signal and points at the duplicate', () => {
      const config = modbus({
        registerMap: [
          ...DEFAULT_MODBUS_REGISTER_MAP,
          { signal: 'state', fc: 3, offset: 1, type: 'uint16' },
        ],
      });

      expect(issuesOf(Protocol.MODBUS, config)).toEqual([
        {
          path: 'config.registerMap[5].signal',
          message: 'signal "state" appears more than once',
        },
      ]);
    });

    it('rejects a range wider than 125 registers per function code', () => {
      const config = modbus({
        registerMap: DEFAULT_MODBUS_REGISTER_MAP.map((e) =>
          e.signal === 'scrapCount' ? { ...e, offset: 125 } : e,
        ),
      });

      const issues = issuesOf(Protocol.MODBUS, config);
      expect(issues).toHaveLength(1);
      expect(issues[0].path).toBe('config.registerMap');
      expect(issues[0].message).toContain('span 126 registers');
    });

    it('accepts a range of exactly 125 registers', () => {
      const config = modbus({
        registerMap: DEFAULT_MODBUS_REGISTER_MAP.map((e) =>
          e.signal === 'scrapCount' ? { ...e, offset: 124 } : e,
        ),
      });

      expect(() => parseDeviceConfig(Protocol.MODBUS, config)).not.toThrow();
    });

    it('requires wordOrder for 32-bit types and forbids it for 16-bit ones', () => {
      const config = modbus({
        registerMap: DEFAULT_MODBUS_REGISTER_MAP.map((e) => {
          if (e.signal === 'motorTempC') {
            return { ...e, wordOrder: undefined };
          }
          return e.signal === 'scrapCount' ? { ...e, wordOrder: 'ABCD' } : e;
        }),
      });

      expect(issuesOf(Protocol.MODBUS, config)).toEqual([
        {
          path: 'config.registerMap[1].wordOrder',
          message: 'wordOrder (ABCD or CDAB) is required for float32',
        },
        {
          path: 'config.registerMap[3].wordOrder',
          message: 'wordOrder is only allowed for 32-bit types',
        },
      ]);
    });

    it('only allows state as uint16 with scale 1', () => {
      const config = modbus({
        registerMap: DEFAULT_MODBUS_REGISTER_MAP.map((e) =>
          e.signal === 'state' ? { ...e, scale: 2 } : e,
        ),
      });

      expect(issuesOf(Protocol.MODBUS, config)).toEqual([
        {
          path: 'config.registerMap[4].type',
          message: 'state must be uint16 with scale 1',
        },
      ]);
    });

    it('rejects out-of-range fields, unknown fields and a bad function code', () => {
      const config = modbus({
        port: 70000,
        unitId: 0,
        pollIntervalMs: 50,
        pollInteval: 1000,
        registerMap: DEFAULT_MODBUS_REGISTER_MAP.map((e) =>
          e.signal === 'scrapCount' ? { ...e, fc: 6 } : e,
        ),
      });

      const paths = issuesOf(Protocol.MODBUS, config).map((i) => i.path);
      expect(paths).toEqual(
        expect.arrayContaining([
          'config.port',
          'config.unitId',
          'config.pollIntervalMs',
          'config',
          'config.registerMap[3].fc',
        ]),
      );
    });

    it('rejects a non-positive scale', () => {
      const config = modbus({
        registerMap: DEFAULT_MODBUS_REGISTER_MAP.map((e) =>
          e.signal === 'motorCurrentA' ? { ...e, scale: 0 } : e,
        ),
      });

      expect(issuesOf(Protocol.MODBUS, config)[0].path).toBe(
        'config.registerMap[2].scale',
      );
    });
  });

  describe('MQTT', () => {
    it('accepts a valid config and defaults staleAfterMs', () => {
      const parsed = parseDeviceConfig(Protocol.MQTT, {
        brokerUrl: 'mqtt://broker:1883',
        topicPrefix: 'factory/line2',
      });

      expect(parsed).toEqual({
        protocol: Protocol.MQTT,
        config: {
          brokerUrl: 'mqtt://broker:1883',
          topicPrefix: 'factory/line2',
          staleAfterMs: 3000,
        },
      });
    });

    it.each([
      ['http://broker:1883'],
      ['mqtts://broker:8883'],
      ['mqtt://'],
      ['broker:1883'],
    ])('rejects broker URL %s', (brokerUrl) => {
      expect(issuesOf(Protocol.MQTT, mqtt({ brokerUrl }))).toEqual([
        {
          path: 'config.brokerUrl',
          message: 'brokerUrl must be a valid URL starting with mqtt://',
        },
      ]);
    });

    it.each([['factory/#'], ['factory/+/x'], ['factory/'], ['']])(
      'rejects topic prefix "%s"',
      (topicPrefix) => {
        expect(issuesOf(Protocol.MQTT, mqtt({ topicPrefix }))[0].path).toBe(
          'config.topicPrefix',
        );
      },
    );
  });

  it('validates the config against the given protocol', () => {
    expect(issuesOf(Protocol.MQTT, modbus()).length).toBeGreaterThan(0);
    expect(issuesOf(Protocol.MODBUS, mqtt()).length).toBeGreaterThan(0);
  });
});
