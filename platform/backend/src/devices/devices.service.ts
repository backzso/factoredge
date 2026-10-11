import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { isDeepStrictEqual } from 'node:util';
import { ZodError } from 'zod';
import { formatZodIssues } from '../common/zod-issues';
import { ConnectorManager } from '../connectors/connector-manager.service';
import {
  type DeviceHealth,
  DeviceHealthService,
} from '../device-health/device-health.service';
import type { DeviceChange } from '../events/event-types';
import { EventsService } from '../events/events.service';
import { EventSeverity, Prisma, Protocol } from '../generated/prisma/client';
import { isRecordNotFound, isUniqueViolation } from '../prisma/prisma-errors';
import { PrismaService } from '../prisma/prisma.service';
import type { AuthUser } from '../users/user.select';
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
    private readonly events: EventsService,
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

  async create(dto: CreateDeviceDto, actor: AuthUser): Promise<DeviceView> {
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
    this.events.record({
      type: 'device.created',
      severity: EventSeverity.INFO,
      deviceId: row.id,
      actor,
      data: { deviceName: row.name, protocol: row.protocol },
    });
    return withPendingHealth(row);
  }

  async update(
    id: string,
    dto: UpdateDeviceDto,
    actor: AuthUser,
  ): Promise<DeviceView> {
    if (
      dto.name === undefined &&
      dto.enabled === undefined &&
      dto.config === undefined
    ) {
      throw new BadRequestException(
        'Provide at least one of: name, enabled, config',
      );
    }

    // Read first: the protocol (never changes) validates the config, and the
    // previous values tell the event what changed. Not atomic with the update:
    // under concurrent edits the change list can be off, the row never is.
    const existing = await this.prisma.device.findUnique({
      where: { id },
      select: { protocol: true, name: true, enabled: true, config: true },
    });
    if (!existing) {
      throw new NotFoundException('Device not found');
    }
    let config: DeviceConfig['config'] | undefined;
    if (dto.config !== undefined) {
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

    const changes = changedFields(existing, row);
    if (changes.length > 0) {
      this.events.record({
        type: 'device.updated',
        severity: EventSeverity.INFO,
        deviceId: id,
        actor,
        data: {
          deviceName: row.name,
          ...(changes.includes('name') ? { previousName: existing.name } : {}),
          changes,
          enabled: row.enabled,
        },
      });
    }
    return withPendingHealth(row);
  }

  async remove(id: string, actor: AuthUser): Promise<void> {
    let deleted: { name: string; protocol: Protocol };
    try {
      // Readings are removed by ON DELETE CASCADE; events stay (device_id SET NULL).
      deleted = await this.prisma.device.delete({
        where: { id },
        select: { name: true, protocol: true },
      });
    } catch (error) {
      throw mapWriteError(error);
    }
    void this.connectors.deviceDeleted(id);
    // The row is gone, so the event cannot reference it; the name is in data.
    this.events.record({
      type: 'device.deleted',
      severity: EventSeverity.INFO,
      actor,
      data: { deviceName: deleted.name, protocol: deleted.protocol },
    });
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

type ChangeableFields = Pick<DeviceRow, 'name' | 'enabled' | 'config'>;

/**
 * Both sides come from the database. Deep comparison ignores key order, which
 * jsonb does not preserve.
 */
function changedFields(
  before: ChangeableFields,
  after: ChangeableFields,
): DeviceChange[] {
  const changes: DeviceChange[] = [];
  if (before.name !== after.name) changes.push('name');
  if (before.enabled !== after.enabled) changes.push('enabled');
  if (!isDeepStrictEqual(before.config, after.config)) changes.push('config');
  return changes;
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
