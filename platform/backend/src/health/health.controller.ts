import {
  Controller,
  Get,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Public } from '../auth/public.decorator';
import { PrismaService } from '../prisma/prisma.service';

interface HealthStatus {
  status: 'ok' | 'error';
  db: 'up' | 'down';
}

@Controller('health')
export class HealthController {
  private readonly logger = new Logger(HealthController.name);

  constructor(private readonly prisma: PrismaService) {}

  @Public()
  @Get()
  async check(): Promise<HealthStatus> {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return { status: 'ok', db: 'up' };
    } catch (error) {
      this.logger.warn(`Database health check failed: ${String(error)}`);
      // 503 so load balancers and container health checks see the failure.
      throw new ServiceUnavailableException({
        status: 'error',
        db: 'down',
      } satisfies HealthStatus);
    }
  }
}
