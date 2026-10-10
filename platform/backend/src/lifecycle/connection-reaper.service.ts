import {
  BeforeApplicationShutdown,
  Injectable,
  Logger,
  OnApplicationShutdown,
} from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import type { Server } from 'node:http';
import {
  CLOSE_IDLE_CONNECTIONS_EVERY_MS,
  FORCE_CLOSE_CONNECTIONS_AFTER_MS,
} from './shutdown.constants';

/**
 * Lets the HTTP server close promptly. Nest closes it with server.close(),
 * which closes idle keep-alive connections only once, when called, and then
 * waits for every other connection.
 *
 * - Connections that become idle later (an SSE response ended on shutdown, a
 *   request that just finished) are closed as soon as they are idle.
 * - Safety net: whatever is still open after a grace period is closed by force.
 */
@Injectable()
export class ConnectionReaper
  implements BeforeApplicationShutdown, OnApplicationShutdown
{
  private readonly logger = new Logger(ConnectionReaper.name);
  private idleSweeper: NodeJS.Timeout | undefined;
  private forceTimer: NodeJS.Timeout | undefined;

  constructor(private readonly adapterHost: HttpAdapterHost) {}

  beforeApplicationShutdown(): void {
    const server = this.adapterHost.httpAdapter?.getHttpServer() as
      Server | undefined;
    if (!server) return;
    this.idleSweeper = setInterval(
      () => server.closeIdleConnections(),
      CLOSE_IDLE_CONNECTIONS_EVERY_MS,
    );
    this.forceTimer = setTimeout(() => {
      this.logger.warn(
        `connections still open ${FORCE_CLOSE_CONNECTIONS_AFTER_MS} ms into shutdown; closing them`,
      );
      server.closeAllConnections();
    }, FORCE_CLOSE_CONNECTIONS_AFTER_MS);
    // Neither keeps the process alive by itself.
    this.idleSweeper.unref();
    this.forceTimer.unref();
  }

  onApplicationShutdown(): void {
    clearInterval(this.idleSweeper);
    clearTimeout(this.forceTimer);
  }
}
