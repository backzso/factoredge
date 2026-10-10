import { Logger } from '@nestjs/common';
import { DeviceHealthService } from '../device-health/device-health.service';
import type { DeviceConfig } from '../devices/device-config.schema';
import type { PrismaService } from '../prisma/prisma.service';
import {
  type RealtimeEvent,
  RealtimeService,
} from '../realtime/realtime.service';
import { TelemetryService } from '../telemetry/telemetry.service';
import { ConnectorManager } from './connector-manager.service';
import type {
  Connector,
  ConnectorFactory,
  ConnectorSink,
  TelemetrySample,
} from './connector.types';

const DEVICE_ID = '7d3f0c52-1111-4222-8333-444455556666';

interface DeviceRow {
  protocol: 'MQTT' | 'MODBUS';
  config: unknown;
  enabled: boolean;
}

const mqttRow = (topicPrefix: string, enabled = true): DeviceRow => ({
  protocol: 'MQTT',
  config: { brokerUrl: 'mqtt://broker:1883', topicPrefix },
  enabled,
});

const SAMPLE: TelemetrySample = {
  ts: new Date('2026-10-08T12:00:00Z'),
  productionCount: 10,
  scrapCount: 1,
  motorTempC: 70,
  motorCurrentA: 12,
  state: 'RUNNING',
};

const tick = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));

/** Records the lifecycle of every connector it creates. */
class FakeConnectors {
  readonly log: string[] = [];
  readonly created: Array<{
    n: number;
    config: DeviceConfig;
    sink: ConnectorSink;
    tag: string;
  }> = [];
  active = 0;
  maxActive = 0;
  stopDelayMs = 0;

  readonly factory: ConnectorFactory = (config, sink, { tag }) => {
    const n = this.created.length + 1;
    this.created.push({ n, config, sink, tag });
    const connector: Connector = {
      start: () => {
        this.log.push(`start#${n}`);
        this.active += 1;
        this.maxActive = Math.max(this.maxActive, this.active);
      },
      stop: async () => {
        this.log.push(`stop-begin#${n}`);
        await tick(this.stopDelayMs);
        this.active -= 1;
        this.log.push(`stop-end#${n}`);
      },
    };
    return connector;
  };

  last() {
    return this.created[this.created.length - 1];
  }
}

describe('ConnectorManager', () => {
  let db: Map<string, DeviceRow>;
  let prisma: {
    device: { findUnique: jest.Mock; findMany: jest.Mock };
    reading: { createMany: jest.Mock };
  };
  let fakes: FakeConnectors;
  let health: DeviceHealthService;
  let telemetry: TelemetryService;
  let events: RealtimeEvent[];
  let manager: ConnectorManager;

  beforeAll(() => {
    // Keep expected error logs (failing operations) out of the test output.
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  beforeEach(() => {
    db = new Map();
    prisma = {
      device: {
        findUnique: jest.fn(({ where }: { where: { id: string } }) =>
          Promise.resolve(db.get(where.id) ?? null),
        ),
        findMany: jest.fn(() =>
          Promise.resolve([...db.keys()].map((id) => ({ id }))),
        ),
      },
      reading: { createMany: jest.fn(() => Promise.resolve({ count: 1 })) },
    };
    fakes = new FakeConnectors();
    const realtime = new RealtimeService();
    events = [];
    realtime.events$.subscribe((event) => events.push(event));
    const prismaService = prisma as unknown as PrismaService;
    health = new DeviceHealthService(realtime);
    telemetry = new TelemetryService(prismaService, health, realtime);
    manager = new ConnectorManager(
      prismaService,
      telemetry,
      health,
      realtime,
      fakes.factory,
    );
  });

  it('starts a connector for an added device with the parsed config', async () => {
    db.set(DEVICE_ID, mqttRow('factory/line2'));

    await manager.deviceSaved(DEVICE_ID);

    expect(fakes.log).toEqual(['start#1']);
    expect(fakes.last().config).toEqual({
      protocol: 'MQTT',
      config: {
        brokerUrl: 'mqtt://broker:1883',
        topicPrefix: 'factory/line2',
        staleAfterMs: 3000,
      },
    });
    expect(fakes.last().tag).toBe('7d3f0c52');
    expect(health.get(DEVICE_ID)?.status).toBe('CONNECTING');
  });

  it('routes connector callbacks to health and telemetry', async () => {
    db.set(DEVICE_ID, mqttRow('factory/line2'));
    await manager.deviceSaved(DEVICE_ID);
    const { sink } = fakes.last();

    sink.onConnection({ type: 'connected' });
    sink.onTelemetry(SAMPLE);

    expect(health.get(DEVICE_ID)?.status).toBe('ONLINE');
    expect(telemetry.latest(DEVICE_ID)?.productionCount).toBe(10);
    expect(prisma.reading.createMany).toHaveBeenCalledTimes(1);
    expect(events.map((e) => e.type)).toEqual(
      expect.arrayContaining(['status', 'telemetry']),
    );
  });

  it('on edit, stops the old connector before starting the new one', async () => {
    fakes.stopDelayMs = 10;
    db.set(DEVICE_ID, mqttRow('old'));
    await manager.deviceSaved(DEVICE_ID);
    fakes.last().sink.onTelemetry(SAMPLE);

    db.set(DEVICE_ID, mqttRow('new'));
    await manager.deviceSaved(DEVICE_ID);

    expect(fakes.log).toEqual([
      'start#1',
      'stop-begin#1',
      'stop-end#1',
      'start#2',
    ]);
    expect(fakes.last().config.config).toMatchObject({ topicPrefix: 'new' });
    // Health and the last value start over for the new connector.
    expect(health.get(DEVICE_ID)).toEqual({
      status: 'CONNECTING',
      lastSeenAt: null,
      lastError: null,
    });
    expect(telemetry.latest(DEVICE_ID)).toBeUndefined();
  });

  it('on delete, stops the connector, forgets the device and announces it', async () => {
    db.set(DEVICE_ID, mqttRow('factory/line2'));
    await manager.deviceSaved(DEVICE_ID);
    fakes.last().sink.onTelemetry(SAMPLE);

    db.delete(DEVICE_ID);
    await manager.deviceDeleted(DEVICE_ID);

    expect(fakes.log).toEqual(['start#1', 'stop-begin#1', 'stop-end#1']);
    expect(health.get(DEVICE_ID)).toBeUndefined();
    expect(telemetry.latest(DEVICE_ID)).toBeUndefined();
    expect(events[events.length - 1]).toEqual({
      type: 'device-removed',
      data: { deviceId: DEVICE_ID },
    });
  });

  it('keeps at most one connector active during rapid successive edits', async () => {
    fakes.stopDelayMs = 5;
    db.set(DEVICE_ID, mqttRow('v0'));
    void manager.deviceSaved(DEVICE_ID);

    for (let version = 1; version <= 5; version++) {
      db.set(DEVICE_ID, mqttRow(`v${version}`));
      void manager.deviceSaved(DEVICE_ID);
      await tick(1);
    }
    await manager.whenIdle(DEVICE_ID);

    expect(fakes.maxActive).toBe(1);
    expect(fakes.active).toBe(1);
    expect(fakes.last().config.config).toMatchObject({ topicPrefix: 'v5' });
  });

  it('applies the latest database state even if requests are enqueued out of order', async () => {
    db.set(DEVICE_ID, mqttRow('committed-last'));

    // Two reconciliations queued for a single committed state: both converge on it.
    await Promise.all([
      manager.deviceSaved(DEVICE_ID),
      manager.deviceSaved(DEVICE_ID),
    ]);

    expect(fakes.active).toBe(1);
    expect(fakes.last().config.config).toMatchObject({
      topicPrefix: 'committed-last',
    });
  });

  it('ignores callbacks from a connector after it was stopped', async () => {
    db.set(DEVICE_ID, mqttRow('factory/line2'));
    await manager.deviceSaved(DEVICE_ID);
    const staleSink = fakes.last().sink;

    db.delete(DEVICE_ID);
    await manager.deviceDeleted(DEVICE_ID);
    const eventCount = events.length;

    staleSink.onConnection({ type: 'connected' });
    staleSink.onTelemetry(SAMPLE);

    expect(prisma.reading.createMany).not.toHaveBeenCalled();
    expect(health.get(DEVICE_ID)).toBeUndefined();
    expect(telemetry.latest(DEVICE_ID)).toBeUndefined();
    expect(events).toHaveLength(eventCount);
  });

  it('drops samples of a deleted device before its queued stop runs', async () => {
    fakes.stopDelayMs = 20;
    db.set(DEVICE_ID, mqttRow('factory/line2'));
    await manager.deviceSaved(DEVICE_ID);
    const sink = fakes.last().sink;

    // Keep the queue busy so the delete's reconciliation has to wait.
    void manager.deviceSaved(DEVICE_ID);
    db.delete(DEVICE_ID);
    const deleted = manager.deviceDeleted(DEVICE_ID);
    sink.onTelemetry(SAMPLE);
    await deleted;

    expect(prisma.reading.createMany).not.toHaveBeenCalled();
  });

  it('keeps the queue going after an operation fails', async () => {
    db.set(DEVICE_ID, mqttRow('factory/line2'));
    prisma.device.findUnique.mockRejectedValueOnce(new Error('db down'));

    await manager.deviceSaved(DEVICE_ID);
    expect(fakes.created).toHaveLength(0);
    expect(health.get(DEVICE_ID)).toMatchObject({
      status: 'OFFLINE',
      lastError: 'could not load device: db down',
    });

    await manager.deviceSaved(DEVICE_ID);
    expect(fakes.log).toEqual(['start#1']);
  });

  it('does not start a disabled device and reports it as DISABLED', async () => {
    db.set(DEVICE_ID, mqttRow('factory/line2', false));

    await manager.deviceSaved(DEVICE_ID);

    expect(fakes.created).toHaveLength(0);
    expect(health.get(DEVICE_ID)?.status).toBe('DISABLED');
  });

  it('reports an invalid stored config instead of starting', async () => {
    db.set(DEVICE_ID, {
      protocol: 'MQTT',
      config: { brokerUrl: 'http://x' },
      enabled: true,
    });

    await manager.deviceSaved(DEVICE_ID);

    expect(fakes.created).toHaveLength(0);
    expect(health.get(DEVICE_ID)?.status).toBe('OFFLINE');
    expect(health.get(DEVICE_ID)?.lastError).toMatch(/^invalid config: /);
  });

  it('reconciles every device on bootstrap and stops them all on destroy', async () => {
    const otherId = '00000000-0000-4000-8000-000000000002';
    db.set(DEVICE_ID, mqttRow('a'));
    db.set(otherId, mqttRow('b', false));

    await manager.onApplicationBootstrap();
    await manager.whenIdle(DEVICE_ID);
    await manager.whenIdle(otherId);

    expect(fakes.active).toBe(1);
    expect(health.get(otherId)?.status).toBe('DISABLED');

    await manager.onModuleDestroy();
    expect(fakes.active).toBe(0);

    // No new connectors once shutting down.
    await manager.deviceSaved(DEVICE_ID);
    expect(fakes.created).toHaveLength(1);
  });
});
