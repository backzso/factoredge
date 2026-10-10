import { Logger } from '@nestjs/common';
import ModbusRTU from 'modbus-serial';
import type {
  ModbusConfig,
  RegisterMapEntry,
} from '../../devices/device-config.schema';
import { errorMessage } from '../../common/error-message';
import { LogThrottle } from '../../common/log-throttle';
import { withTimeout } from '../async-utils';
import type {
  Connector,
  ConnectorOptions,
  ConnectorSink,
} from '../connector.types';
import {
  decodeSample,
  planReadRanges,
  type ReadRange,
  type RegisterBlocks,
} from './register-decoder';

/** Delay before reconnect attempt n (1-based); the last value repeats. */
const BACKOFF_MS = [1_000, 2_000, 4_000, 8_000, 10_000];

/**
 * Polls one Modbus TCP device.
 *
 * - Each poll is scheduled with setTimeout after the previous one finished, so a
 *   slow device can never pile up concurrent requests.
 * - Any error (connect, timeout, exception response, socket closed) drops the
 *   connection and reconnects with backoff; a successful read resets the backoff.
 * - Every async step carries the run number it was started with. stop() bumps
 *   the run, so callbacks from a stopped run see they are stale and do nothing.
 */
export class ModbusConnector implements Connector {
  private readonly logger: Logger;
  private readonly throttle: LogThrottle;
  private readonly ranges: ReadRange[];
  private readonly registerMap: RegisterMapEntry[];

  private run = 0;
  private running = false;
  private client: ModbusRTU | undefined;
  private timer: NodeJS.Timeout | undefined;
  private failures = 0;

  constructor(
    private readonly config: ModbusConfig,
    private readonly sink: ConnectorSink,
    options: ConnectorOptions,
  ) {
    this.logger = new Logger(`ModbusConnector ${options.tag}`);
    this.throttle = new LogThrottle(this.logger);
    this.registerMap = config.registerMap;
    this.ranges = planReadRanges(config.registerMap);
  }

  start(): void {
    if (this.running) {
      return;
    }
    this.running = true;
    const run = ++this.run;
    this.schedule(0, () => this.connect(run));
  }

  stop(): Promise<void> {
    if (this.running) {
      this.running = false;
      this.run += 1;
      clearTimeout(this.timer);
      this.timer = undefined;
      // destroy() is synchronous, so stop is bounded without an extra timeout.
      destroyQuietly(this.client);
      this.client = undefined;
    }
    return Promise.resolve();
  }

  private isCurrent(run: number): boolean {
    return this.running && run === this.run;
  }

  private schedule(delayMs: number, step: () => Promise<void>): void {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = undefined;
      void step();
    }, delayMs);
  }

  private async connect(run: number): Promise<void> {
    if (!this.isCurrent(run)) {
      return;
    }
    this.sink.onConnection({ type: 'connecting' });

    const client = new ModbusRTU();
    // Without a listener an 'error' event would crash the process. Failures
    // also surface as rejected requests or a 'close' event, handled below.
    client.on('error', (error) =>
      this.logger.debug(`client error: ${errorMessage(error)}`),
    );
    client.on('close', () =>
      this.fail(run, client, new Error('connection closed by peer')),
    );
    this.client = client;

    const { host, port, unitId, timeoutMs } = this.config;
    try {
      await withTimeout(
        client.connectTCP(host, { port }),
        timeoutMs,
        `connect to ${host}:${port} timed out after ${timeoutMs} ms`,
      );
    } catch (error) {
      this.fail(run, client, error);
      return;
    }
    if (!this.isCurrent(run) || this.client !== client) {
      destroyQuietly(client);
      return;
    }
    client.setID(unitId);
    client.setTimeout(timeoutMs);
    this.sink.onConnection({ type: 'connected' });
    await this.poll(run, client);
  }

  private async poll(run: number, client: ModbusRTU): Promise<void> {
    const startedAt = Date.now();
    const blocks: RegisterBlocks = {};
    try {
      for (const range of this.ranges) {
        const result =
          range.fc === 3
            ? await client.readHoldingRegisters(range.start, range.count)
            : await client.readInputRegisters(range.start, range.count);
        blocks[range.fc] = { start: range.start, data: result.data };
      }
    } catch (error) {
      this.fail(run, client, error);
      return;
    }
    if (!this.isCurrent(run) || this.client !== client) {
      return;
    }

    // The moment the last response arrived.
    const ts = new Date();
    this.failures = 0;

    const decoded = decodeSample(this.registerMap, blocks);
    if (decoded.ok) {
      this.sink.onTelemetry({ ts, ...decoded.values });
    } else {
      // A bad value is a data problem, not a connection problem: drop the sample, keep polling.
      this.throttle.warn(`invalid sample dropped: ${decoded.error}`);
    }

    // Keep a steady cadence: the next poll starts pollIntervalMs after this one started.
    const elapsed = Date.now() - startedAt;
    this.schedule(Math.max(0, this.config.pollIntervalMs - elapsed), () =>
      this.poll(run, client),
    );
  }

  private fail(run: number, client: ModbusRTU, error: unknown): void {
    destroyQuietly(client);
    // A failed read and the following 'close' event both land here; act once.
    if (!this.isCurrent(run) || this.client !== client) {
      return;
    }
    this.client = undefined;

    const message = errorMessage(error);
    const delay = BACKOFF_MS[Math.min(this.failures, BACKOFF_MS.length - 1)];
    this.failures += 1;

    this.throttle.warn(message);
    this.logger.debug(`reconnecting in ${delay} ms`);
    this.sink.onConnection({ type: 'disconnected', error: message });
    this.schedule(delay, () => this.connect(run));
  }
}

function destroyQuietly(client: ModbusRTU | undefined): void {
  if (!client) {
    return;
  }
  try {
    client.destroy(() => undefined);
  } catch {
    // Already closed or never opened: nothing to release.
  }
}
