import {
  BadRequestException,
  Injectable,
  Logger,
  OnModuleDestroy,
} from '@nestjs/common';
import { errorMessage } from '../common/error-message';
import { LogThrottle } from '../common/log-throttle';
import { Prisma, Role } from '../generated/prisma/client';
import { isForeignKeyViolation } from '../prisma/prisma-errors';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeService } from '../realtime/realtime.service';
import {
  describeEventEn,
  type EventDto,
  type NewEvent,
  USER_EVENT_PREFIX,
} from './event-types';

const eventSelect = {
  id: true,
  ts: true,
  type: true,
  severity: true,
  deviceId: true,
  data: true,
} satisfies Prisma.EventSelect;

type EventRow = Prisma.EventGetPayload<{ select: typeof eventSelect }>;

export interface EventsPage {
  items: EventDto[];
  /** Pass as `before` for the next (older) page; null on the last page. */
  nextCursor: string | null;
}

export interface EventsQuery {
  limit: number;
  before?: string;
  deviceId?: string;
}

@Injectable()
export class EventsService implements OnModuleDestroy {
  private readonly logger = new Logger(EventsService.name);
  private readonly throttle = new LogThrottle(this.logger);
  // Writes run one after another in record order, so the database and the live
  // stream see events in the order they happened. Events are rare (state
  // changes and admin actions), so one at a time is plenty.
  private queue: Promise<void> = Promise.resolve();
  private lastTs = 0;

  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeService,
  ) {}

  /**
   * Stores the event in the background and then publishes it to the live
   * stream. Never throws and never blocks the caller: a failed write is logged
   * and the event is lost, the action that caused it is not affected.
   *
   * The timestamp is taken now, not when the write gets its turn, and is
   * strictly increasing within the process: two events of the same
   * millisecond (a fault that starts and ends between two polls) keep their order.
   */
  record(event: NewEvent): void {
    this.lastTs = Math.max(Date.now(), this.lastTs + 1);
    const ts = new Date(this.lastTs);
    this.queue = this.queue
      .then(() => this.write(event, ts))
      .catch((error: unknown) => {
        this.throttle.error(
          `failed to record ${event.type}: ${errorMessage(error)}`,
        );
      });
  }

  /** Resolves once every event recorded so far is written (or dropped). */
  async flush(): Promise<void> {
    let current: Promise<void>;
    do {
      current = this.queue;
      await current;
    } while (current !== this.queue);
  }

  /** Pending writes finish before Prisma disconnects (it is destroyed later). */
  onModuleDestroy(): Promise<void> {
    return this.flush();
  }

  /** Newest first. user.* events only for ADMIN. */
  async list(query: EventsQuery, role: Role): Promise<EventsPage> {
    const conditions: Prisma.EventWhereInput[] = [];
    if (query.deviceId) {
      conditions.push({ deviceId: query.deviceId });
    }
    if (role !== Role.ADMIN) {
      conditions.push({ NOT: { type: { startsWith: USER_EVENT_PREFIX } } });
    }
    if (query.before) {
      const cursor = decodeCursor(query.before);
      conditions.push({
        OR: [
          { ts: { lt: cursor.ts } },
          { ts: cursor.ts, id: { lt: cursor.id } },
        ],
      });
    }

    const rows = await this.prisma.event.findMany({
      where: { AND: conditions },
      orderBy: [{ ts: 'desc' }, { id: 'desc' }],
      // One extra row tells whether there is another page.
      take: query.limit + 1,
      select: eventSelect,
    });
    const items = rows.slice(0, query.limit);
    const last = items.at(-1);
    return {
      items: items.map(toEventDto),
      nextCursor: rows.length > query.limit && last ? encodeCursor(last) : null,
    };
  }

  private async write(event: NewEvent, ts: Date): Promise<void> {
    const data: Record<string, unknown> = { ...event.data };
    if (event.actor) {
      data.actorUsername = event.actor.username;
    }
    if (event.deviceId && data.deviceName === undefined) {
      const device = await this.prisma.device.findUnique({
        where: { id: event.deviceId },
        select: { name: true },
      });
      if (!device) {
        this.logger.debug(`${event.type} for deleted device dropped`);
        return;
      }
      data.deviceName = device.name;
    }

    const message = describeEventEn(event.type, data);
    let row: EventRow;
    try {
      row = await this.prisma.event.create({
        data: {
          ts,
          type: event.type,
          severity: event.severity,
          deviceId: event.deviceId ?? null,
          userId: event.actor?.id ?? null,
          data: data as Prisma.InputJsonObject,
          message,
        },
        select: eventSelect,
      });
    } catch (error) {
      if (isForeignKeyViolation(error)) {
        // The device or the actor was deleted while the event was in flight.
        this.logger.debug(`${event.type} for a deleted row dropped`);
        return;
      }
      throw error;
    }
    this.logger.log(`[${event.severity}] ${message}`);
    this.realtime.publish({ type: 'event', data: toEventDto(row) });
  }
}

function toEventDto(row: EventRow): EventDto {
  return {
    id: row.id,
    ts: row.ts.toISOString(),
    type: row.type,
    severity: row.severity,
    deviceId: row.deviceId,
    data: (row.data ?? {}) as Record<string, unknown>,
  };
}

// The cursor is opaque to clients: base64url of "<ISO ts>|<id>" of the last
// item. Ordering is (ts, id) descending, so the next page is everything
// strictly before that pair.

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function encodeCursor(row: EventRow): string {
  return Buffer.from(`${row.ts.toISOString()}|${row.id}`).toString('base64url');
}

function decodeCursor(cursor: string): { ts: Date; id: string } {
  const [iso, id, ...rest] = Buffer.from(cursor, 'base64url')
    .toString('utf8')
    .split('|');
  const ts = new Date(iso ?? '');
  if (
    rest.length > 0 ||
    !id ||
    !UUID_PATTERN.test(id) ||
    Number.isNaN(ts.getTime())
  ) {
    throw new BadRequestException('Invalid cursor');
  }
  return { ts, id };
}
