import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { errorMessage } from '../common/error-message';
import { LogThrottle } from '../common/log-throttle';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeService } from './realtime.service';

export const SESSION_CHECK_INTERVAL_MS = 30_000;

/**
 * Safety net for the targeted session events: every 30 s, the users with an
 * open stream are looked up, and the streams of a user who no longer exists
 * end with session-ended. This catches what the users service cannot announce,
 * e.g. a user deleted directly in the database, or a stream that registered
 * just after its user's deletion was announced.
 */
@Injectable()
export class SessionWatchService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SessionWatchService.name);
  private readonly throttle = new LogThrottle(this.logger);
  private timer: NodeJS.Timeout | undefined;
  private sweeping = false;

  constructor(
    private readonly realtime: RealtimeService,
    private readonly prisma: PrismaService,
  ) {}

  onModuleInit(): void {
    this.timer = setInterval(
      () => void this.sweep(),
      SESSION_CHECK_INTERVAL_MS,
    );
    this.timer.unref();
  }

  onModuleDestroy(): void {
    clearInterval(this.timer);
  }

  /** One check of every connected user; also called directly by the tests. */
  async sweep(): Promise<void> {
    // A slow database must not stack up checks.
    if (this.sweeping) return;
    const userIds = this.realtime.connectedUserIds();
    if (userIds.length === 0) return;

    this.sweeping = true;
    try {
      const existing = await this.prisma.user.findMany({
        where: { id: { in: userIds } },
        select: { id: true },
      });
      const found = new Set(existing.map((user) => user.id));
      for (const userId of userIds) {
        if (!found.has(userId)) {
          this.realtime.endSessions(userId, 'deleted');
        }
      }
    } catch (error) {
      // An unreachable database says nothing about the user: keep the streams.
      this.throttle.warn(`session check failed: ${errorMessage(error)}`);
    } finally {
      this.sweeping = false;
    }
  }
}
