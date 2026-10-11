import { Controller, Get, Query } from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthUser } from '../users/user.select';
import { EventsQueryDto } from './dto/events-query.dto';
import { type EventsPage, EventsService } from './events.service';

/**
 * Open to any logged-in user; user.* events are filtered out for everyone but
 * ADMIN (the role comes from the database on every request).
 */
@Controller('events')
export class EventsController {
  constructor(private readonly events: EventsService) {}

  @Get()
  list(
    @Query() query: EventsQueryDto,
    @CurrentUser() user: AuthUser,
  ): Promise<EventsPage> {
    return this.events.list(query, user.role);
  }
}
