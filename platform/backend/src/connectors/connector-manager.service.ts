import {
  Inject,
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from '@nestjs/common';
import { ZodError } from 'zod';
import { errorMessage } from '../common/error-message';
import { summarizeZodError } from '../common/zod-issues';
import { DeviceHealthService } from '../device-health/device-health.service';
import {
  type DeviceConfig,
  parseDeviceConfig,
} from '../devices/device-config.schema';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeService } from '../realtime/realtime.service';
import { TelemetryService } from '../telemetry/telemetry.service';
import { staleAfterMs } from './connector.factory';
import type {
  ConnectionEvent,
  Connector,
  ConnectorFactory,
  ConnectorSink,
  TelemetrySample,
} from './connector.types';

/** DI token for the connector factory; tests swap in a fake. */
export const CONNECTOR_FACTORY = Symbol('CONNECTOR_FACTORY');

/**
 * Binds a connector to one device. Connectors do not know device ids; the sink
 * adds it. `active` is cleared before the connector is stopped, so callbacks
 * that arrive during or after stop() are dropped (no readings for a deleted device).
 */
class ManagedSink implements ConnectorSink {
  active = true;

  constructor(
    private readonly deviceId: string,
    private readonly telemetry: TelemetryService,
    private readonly health: DeviceHealthService,
    private readonly logger: Logger,
  ) {}

  onTelemetry(sample: TelemetrySample): void {
    if (!this.active) return;
    // Never let a platform-side bug propagate into the connector's I/O callbacks.
    try {
      this.telemetry.ingest(this.deviceId, sample);
    } catch (error) {
      this.logger.error(
        `ingest failed for ${this.deviceId}: ${errorMessage(error)}`,
      );
    }
  }

  onConnection(event: ConnectionEvent): void {
    if (!this.active) return;
    try {
      this.health.onConnection(this.deviceId, event);
    } catch (error) {
      this.logger.error(
        `health update failed for ${this.deviceId}: ${errorMessage(error)}`,
      );
    }
  }
}

interface RunningConnector {
  connector: Connector;
  sink: ManagedSink;
}

/**
 * Owns the connector of every device, using a reconciliation pattern:
 * callers only say "device X changed" and the manager brings X's connector in
 * line with the device's current row in the database (start, restart, stop or
 * forget). Because the desired state is read from the database inside the
 * queued operation, concurrent create/update/delete requests cannot leave a
 * connector running with an outdated config or for a deleted device: whichever
 * reconciliation runs last applies the latest committed state.
 *
 * Operations for one device are serialized through a per-device promise chain,
 * so at most one connector per device is ever active. HTTP handlers write the
 * database first, enqueue a reconciliation and return without waiting for it.
 */
@Injectable()
export class ConnectorManager
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private readonly logger = new Logger(ConnectorManager.name);
  private readonly running = new Map<string, RunningConnector>();
  private readonly queues = new Map<string, Promise<void>>();
  private shuttingDown = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly telemetry: TelemetryService,
    private readonly health: DeviceHealthService,
    private readonly realtime: RealtimeService,
    @Inject(CONNECTOR_FACTORY) private readonly factory: ConnectorFactory,
  ) {}

  /** Reconciles every device, disabled ones included, so their health shows DISABLED. */
  async onApplicationBootstrap(): Promise<void> {
    const devices = await this.prisma.device.findMany({ select: { id: true } });
    for (const { id } of devices) {
      void this.reconcileLater(id);
    }
  }

  /**
   * Runs in onModuleDestroy rather than onApplicationShutdown: Nest destroys the
   * global PrismaModule after all other modules' onModuleDestroy hooks, but before
   * any onApplicationShutdown hook. Stopping here keeps samples from reaching a
   * disconnected Prisma client.
   */
  async onModuleDestroy(): Promise<void> {
    this.shuttingDown = true;
    for (const { sink } of this.running.values()) {
      sink.active = false;
    }
    await Promise.allSettled(this.queues.values());
    await Promise.allSettled(
      [...this.running.keys()].map((id) => this.stopRunning(id)),
    );
  }

  /** A device was created or updated. */
  deviceSaved(deviceId: string): Promise<void> {
    return this.reconcileLater(deviceId);
  }

  /** A device was deleted from the database. */
  deviceDeleted(deviceId: string): Promise<void> {
    // Drop its samples right away instead of after the queue gets to it.
    const current = this.running.get(deviceId);
    if (current) {
      current.sink.active = false;
    }
    return this.reconcileLater(deviceId);
  }

  /** Resolves when every queued operation for the device has finished. */
  async whenIdle(deviceId: string): Promise<void> {
    while (this.queues.has(deviceId)) {
      await this.queues.get(deviceId);
    }
  }

  private reconcileLater(deviceId: string): Promise<void> {
    if (this.shuttingDown) {
      return Promise.resolve();
    }
    return this.enqueue(deviceId, () => this.reconcile(deviceId));
  }

  /**
   * Chains `operation` after the device's previous one. A failure is logged and
   * does not break the chain; the entry is removed once the chain drains.
   */
  private enqueue(
    deviceId: string,
    operation: () => Promise<void>,
  ): Promise<void> {
    const previous = this.queues.get(deviceId) ?? Promise.resolve();
    const next = previous.then(operation).catch((error: unknown) => {
      this.logger.error(
        `reconciling device ${deviceId} failed: ${errorMessage(error)}`,
      );
    });
    this.queues.set(deviceId, next);
    void next.then(() => {
      if (this.queues.get(deviceId) === next) {
        this.queues.delete(deviceId);
      }
    });
    return next;
  }

  /** Brings the device's connector in line with its current database row. */
  private async reconcile(deviceId: string): Promise<void> {
    await this.stopRunning(deviceId);
    if (this.shuttingDown) return;

    let device;
    try {
      device = await this.prisma.device.findUnique({
        where: { id: deviceId },
        select: { protocol: true, config: true, enabled: true },
      });
    } catch (error) {
      this.health.markFailed(
        deviceId,
        `could not load device: ${errorMessage(error)}`,
      );
      throw error;
    }

    if (!device) {
      const known = this.health.forget(deviceId);
      this.telemetry.forget(deviceId);
      if (known) {
        this.realtime.publish({ type: 'device-removed', data: { deviceId } });
      }
      return;
    }

    // A restarted connector starts from a clean slate.
    this.telemetry.forget(deviceId);

    let config: DeviceConfig;
    try {
      // The stored JSON is external input too: validate it again.
      config = parseDeviceConfig(device.protocol, device.config);
    } catch (error) {
      const reason =
        error instanceof ZodError
          ? summarizeZodError(error)
          : errorMessage(error);
      this.logger.error(`device ${deviceId} has an invalid config: ${reason}`);
      this.health.markFailed(deviceId, `invalid config: ${reason}`);
      return;
    }

    if (!device.enabled) {
      this.health.markDisabled(deviceId);
      return;
    }
    if (this.shuttingDown) return;

    this.health.reset(deviceId, staleAfterMs(config));
    const sink = new ManagedSink(
      deviceId,
      this.telemetry,
      this.health,
      this.logger,
    );
    try {
      const connector = this.factory(config, sink, {
        tag: deviceId.slice(0, 8),
      });
      this.running.set(deviceId, { connector, sink });
      connector.start();
    } catch (error) {
      sink.active = false;
      this.running.delete(deviceId);
      this.health.markFailed(
        deviceId,
        `connector failed to start: ${errorMessage(error)}`,
      );
      throw error;
    }
  }

  private async stopRunning(deviceId: string): Promise<void> {
    const current = this.running.get(deviceId);
    if (!current) {
      return;
    }
    current.sink.active = false;
    this.running.delete(deviceId);
    try {
      await current.connector.stop();
    } catch (error) {
      // stop() must not throw; guard anyway so the queue keeps moving.
      this.logger.error(
        `stopping connector of ${deviceId} failed: ${errorMessage(error)}`,
      );
    }
  }
}
