import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { ReadingsQueryDto } from './dto/readings-query.dto';
import type { ReadingDto } from './reading.mapper';
import { TelemetryService } from './telemetry.service';

/** Open to any logged-in user (global JwtAuthGuard). */
@Controller('devices')
export class ReadingsController {
  constructor(private readonly telemetry: TelemetryService) {}

  /** Readings of the last `minutes` minutes, oldest first. */
  @Get(':id/readings')
  findReadings(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: ReadingsQueryDto,
  ): Promise<ReadingDto[]> {
    return this.telemetry.findReadings(id, query.minutes);
  }
}
