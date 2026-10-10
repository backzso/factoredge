import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { errorMessage } from '../common/error-message';
import { LogThrottle } from '../common/log-throttle';
import type { TelemetrySample } from '../connectors/connector.types';
import { DeviceHealthService } from '../device-health/device-health.service';
import type { Prisma } from '../generated/prisma/client';
import { isForeignKeyViolation } from '../prisma/prisma-errors';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeService } from '../realtime/realtime.service';
import { type ReadingDto, toReadingDto } from './reading.mapper';

const readingSelect = {
  ts: true,
  receivedAt: true,
  productionCount: true,
  scrapCount: true,
  motorTempC: true,
  motorCurrentA: true,
  state: true,
} satisfies Prisma.ReadingSelect;

@Injectable()
export class TelemetryService {
  private readonly logger = new Logger(TelemetryService.name);
  private readonly throttle = new LogThrottle(this.logger);
  private readonly latestByDevice = new Map<string, ReadingDto>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly health: DeviceHealthService,
    private readonly realtime: RealtimeService,
  ) {}

  /**
   * Live path first, persistence last: a slow or failing database never delays
   * or stops the live stream; a failed write is logged and dropped.
   */
  ingest(deviceId: string, sample: TelemetrySample): void {
    const receivedAt = new Date();
    this.health.recordData(deviceId, receivedAt);

    const row = {
      deviceId,
      ts: sample.ts,
      receivedAt,
      productionCount: BigInt(sample.productionCount),
      scrapCount: BigInt(sample.scrapCount),
      motorTempC: sample.motorTempC,
      motorCurrentA: sample.motorCurrentA,
      state: sample.state,
    } satisfies Prisma.ReadingCreateManyInput;

    const reading = toReadingDto(row);
    this.latestByDevice.set(deviceId, reading);
    this.realtime.publish({ type: 'telemetry', data: { deviceId, reading } });

    // skipDuplicates: a re-sent sample (same device + ts) is ignored, not an error.
    this.prisma.reading
      .createMany({ data: [row], skipDuplicates: true })
      .catch((error: unknown) => {
        if (isForeignKeyViolation(error)) {
          // The device was deleted while this sample was in flight.
          this.logger.debug(`reading for deleted device ${deviceId} dropped`);
          return;
        }
        this.throttle.error(`failed to store reading: ${errorMessage(error)}`);
      });
  }

  latest(deviceId: string): ReadingDto | undefined {
    return this.latestByDevice.get(deviceId);
  }

  forget(deviceId: string): void {
    this.latestByDevice.delete(deviceId);
  }

  async findReadings(deviceId: string, minutes: number): Promise<ReadingDto[]> {
    const device = await this.prisma.device.findUnique({
      where: { id: deviceId },
      select: { id: true },
    });
    if (!device) {
      throw new NotFoundException('Device not found');
    }
    const since = new Date(Date.now() - minutes * 60_000);
    const rows = await this.prisma.reading.findMany({
      where: { deviceId, ts: { gte: since } },
      orderBy: { ts: 'asc' },
      select: readingSelect,
    });
    return rows.map(toReadingDto);
  }
}
