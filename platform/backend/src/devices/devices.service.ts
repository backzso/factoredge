import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ZodError } from 'zod';
import { formatZodIssues } from '../common/zod-issues';
import { ConnectorManager } from '../connectors/connector-manager.service';
import {
  type DeviceHealth,
  DeviceHealthService,
} from '../device-health/device-health.service';
import { Prisma, Protocol } from '../generated/prisma/client';
import { isRecordNotFound, isUniqueViolation } from '../prisma/prisma-errors';
import { PrismaService } from '../prisma/prisma.service';
import {
  DEVICE_TEMPLATES,
  type DeviceConfig,
  parseDeviceConfig,
} from './device-config.schema';
import { CreateDeviceDto } from './dto/create-device.dto';
import { UpdateDeviceDto } from './dto/update-device.dto';

const deviceSelect = {
  id: true,
  name: true,
  protocol: true,
  enabled: true,
  config: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.DeviceSelect;

type DeviceRow = Prisma.DeviceGetPayload<{ select: typeof deviceSelect }>;

export type DeviceView = DeviceRow & { health: DeviceHealth };

@Injectable()
export class DevicesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly connectors: ConnectorManager,
    private readonly health: DeviceHealthService,
  ) {}

  async findAll(): Promise<DeviceView[]> {
    const rows = await this.prisma.device.findMany({
      select: deviceSelect,
      orderBy: { createdAt: 'asc' },
    });
    return rows.map((row) => this.withLiveHealth(row));
  }

  async findOne(id: string): Promise<DeviceView> {
    const row = await this.prisma.device.findUnique({
      where: { id },
      select: deviceSelect,
    });
    if (!row) {
      throw new NotFoundException('Device not found');
    }
    return this.withLiveHealth(row);
  }

  templates(): typeof DEVICE_TEMPLATES {
    return DEVICE_TEMPLATES;
  }

  async create(dto: CreateDeviceDto): Promise<DeviceView> {
    const { config } = validateConfig(dto.protocol, dto.config);
    let row: DeviceRow;
    try {
      row = await this.prisma.device.create({
        data: {
          name: dto.name,
          protocol: dto.protocol,
          enabled: dto.enabled ?? true,
          config: config,
        },
        select: deviceSelect,
      });
    } catch (error) {
      throw mapWriteError(error);
    }
    void this.connectors.deviceSaved(row.id);
    return withPendingHealth(row);
  }

  async update(id: string, dto: UpdateDeviceDto): Promise<DeviceView> {
    if (
      dto.name === undefined &&
      dto.enabled === undefined &&
      dto.config === undefined
    ) {
      throw new BadRequestException(
        'Provide at least one of: name, enabled, config',
      );
    }

    let config: DeviceConfig['config'] | undefined;
    if (dto.config !== undefined) {
      // The protocol never changes, so reading it outside the update is safe.
      const existing = await this.prisma.device.findUnique({
        where: { id },
        select: { protocol: true },
      });
      if (!existing) {
        throw new NotFoundException('Device not found');
      }
      config = validateConfig(existing.protocol, dto.config).config;
    }

    let row: DeviceRow;
    try {
      row = await this.prisma.device.update({
        where: { id },
        data: {
          name: dto.name,
          enabled: dto.enabled,
          config: config,
        },
        select: deviceSelect,
      });
    } catch (error) {
      throw mapWriteError(error);
    }
    void this.connectors.deviceSaved(id);
    return withPendingHealth(row);
  }

  async remove(id: string): Promise<void> {
    try {
      // Readings are removed by ON DELETE CASCADE.
      await this.prisma.device.delete({ where: { id } });
    } catch (error) {
      throw mapWriteError(error);
    }
    void this.connectors.deviceDeleted(id);
  }

  private withLiveHealth(row: DeviceRow): DeviceView {
    return {
      ...row,
      health: this.health.get(row.id) ?? pendingHealth(row.enabled),
    };
  }
}

/**
 * The connector is (re)started in the background after the response, so a
 * freshly saved device reports CONNECTING (or DISABLED) rather than the status
 * of the connector being replaced.
 */
function withPendingHealth(row: DeviceRow): DeviceView {
  return { ...row, health: pendingHealth(row.enabled) };
}

function pendingHealth(enabled: boolean): DeviceHealth {
  return {
    status: enabled ? 'CONNECTING' : 'DISABLED',
    lastSeenAt: null,
    lastError: null,
  };
}

function validateConfig(protocol: Protocol, config: unknown): DeviceConfig {
  try {
    return parseDeviceConfig(protocol, config);
  } catch (error) {
    if (error instanceof ZodError) {
      throw new BadRequestException({
        statusCode: 400,
        error: 'Bad Request',
        message: 'Invalid device config',
        issues: formatZodIssues(error),
      });
    }
    throw error;
  }
}

function mapWriteError(error: unknown): unknown {
  if (isUniqueViolation(error)) {
    return new ConflictException('A device with this name already exists');
  }
  if (isRecordNotFound(error)) {
    return new NotFoundException('Device not found');
  }
  return error;
}
