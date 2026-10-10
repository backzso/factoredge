import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import type { ConnectionEvent } from '../connectors/connector.types';
import { RealtimeService } from '../realtime/realtime.service';
import {
  type ConnectionState,
  deriveStatus,
  type DeviceStatus,
} from './derive-status';

const WATCHDOG_INTERVAL_MS = 1_000;

/** Health as exposed by the API and the live stream. */
export interface DeviceHealth {
  status: DeviceStatus;
  lastSeenAt: string | null;
  lastError: string | null;
}

interface HealthEntry {
  enabled: boolean;
  connection: ConnectionState;
  connectedAt?: Date;
  /** When the platform last received a sample (not the device's own timestamp). */
  lastSeenAt?: Date;
  lastError?: string;
  staleAfterMs: number;
  status: DeviceStatus;
}

/**
 * In-memory health of every known device. Statuses are recomputed on every
 * connection event and sample, and by a 1 s watchdog that catches data going
 * stale. A status event is published only when the status actually changes.
 */
@Injectable()
export class DeviceHealthService implements OnModuleInit, OnModuleDestroy {
  private readonly entries = new Map<string, HealthEntry>();
  private watchdog: NodeJS.Timeout | undefined;

  constructor(private readonly realtime: RealtimeService) {}

  onModuleInit(): void {
    this.watchdog = setInterval(
      () => this.recomputeAll(),
      WATCHDOG_INTERVAL_MS,
    );
    this.watchdog.unref();
  }

  onModuleDestroy(): void {
    clearInterval(this.watchdog);
  }

  /** A connector is about to start: forget the previous connection's history. */
  reset(deviceId: string, staleAfterMs: number): void {
    this.replace(deviceId, {
      enabled: true,
      connection: 'connecting',
      staleAfterMs,
      status: 'CONNECTING',
    });
  }

  markDisabled(deviceId: string): void {
    this.replace(deviceId, {
      enabled: false,
      connection: 'disconnected',
      staleAfterMs: 0,
      status: 'DISABLED',
    });
  }

  /** The device is enabled but its connector could not be started (e.g. invalid stored config). */
  markFailed(deviceId: string, error: string): void {
    this.replace(deviceId, {
      enabled: true,
      connection: 'disconnected',
      lastError: error,
      staleAfterMs: 0,
      status: 'OFFLINE',
    });
  }

  onConnection(deviceId: string, event: ConnectionEvent): void {
    const entry = this.entries.get(deviceId);
    if (!entry?.enabled) {
      return;
    }
    entry.connection = event.type;
    if (event.type === 'connected') {
      entry.connectedAt = new Date();
      entry.lastError = undefined;
    } else {
      entry.connectedAt = undefined;
      if (event.type === 'disconnected' && event.error) {
        entry.lastError = event.error;
      }
    }
    this.recompute(deviceId, entry);
  }

  recordData(deviceId: string, receivedAt: Date): void {
    const entry = this.entries.get(deviceId);
    if (!entry?.enabled) {
      return;
    }
    entry.lastSeenAt = receivedAt;
    this.recompute(deviceId, entry);
  }

  /** Returns whether the device was known. */
  forget(deviceId: string): boolean {
    return this.entries.delete(deviceId);
  }

  get(deviceId: string): DeviceHealth | undefined {
    const entry = this.entries.get(deviceId);
    return entry && toView(entry);
  }

  snapshot(): Array<{ deviceId: string } & DeviceHealth> {
    return [...this.entries].map(([deviceId, entry]) => ({
      deviceId,
      ...toView(entry),
    }));
  }

  private replace(deviceId: string, entry: HealthEntry): void {
    const previous = this.entries.get(deviceId)?.status;
    this.entries.set(deviceId, entry);
    if (entry.status !== previous) {
      this.publish(deviceId, entry);
    }
  }

  private recomputeAll(): void {
    for (const [deviceId, entry] of this.entries) {
      this.recompute(deviceId, entry);
    }
  }

  private recompute(deviceId: string, entry: HealthEntry): void {
    if (!entry.enabled) {
      return;
    }
    const status = deriveStatus(
      { ...entry, previousStatus: entry.status },
      new Date(),
    );
    if (status !== entry.status) {
      entry.status = status;
      this.publish(deviceId, entry);
    }
  }

  private publish(deviceId: string, entry: HealthEntry): void {
    this.realtime.publish({
      type: 'status',
      data: { deviceId, ...toView(entry) },
    });
  }
}

function toView(entry: HealthEntry): DeviceHealth {
  return {
    status: entry.status,
    lastSeenAt: entry.lastSeenAt?.toISOString() ?? null,
    lastError: entry.lastError ?? null,
  };
}
