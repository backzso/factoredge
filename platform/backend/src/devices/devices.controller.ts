import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator';
import { Roles } from '../auth/roles.decorator';
import { Role } from '../generated/prisma/client';
import type { AuthUser } from '../users/user.select';
import { type DeviceView, DevicesService } from './devices.service';
import { CreateDeviceDto } from './dto/create-device.dto';
import { UpdateDeviceDto } from './dto/update-device.dto';

/**
 * Reads are open to any logged-in user; create and update are for ADMIN and
 * ENGINEER, delete for ADMIN only.
 */
@Controller('devices')
export class DevicesController {
  constructor(private readonly devices: DevicesService) {}

  @Get()
  findAll(): Promise<DeviceView[]> {
    return this.devices.findAll();
  }

  // Declared before ':id' so "templates" is not parsed as a device id.
  @Get('templates')
  templates(): ReturnType<DevicesService['templates']> {
    return this.devices.templates();
  }

  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string): Promise<DeviceView> {
    return this.devices.findOne(id);
  }

  @Post()
  @Roles(Role.ADMIN, Role.ENGINEER)
  create(
    @Body() dto: CreateDeviceDto,
    @CurrentUser() actor: AuthUser,
  ): Promise<DeviceView> {
    return this.devices.create(dto, actor);
  }

  @Patch(':id')
  @Roles(Role.ADMIN, Role.ENGINEER)
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateDeviceDto,
    @CurrentUser() actor: AuthUser,
  ): Promise<DeviceView> {
    return this.devices.update(id, dto, actor);
  }

  // ADMIN only: deleting also removes the reading history (cascade) and cannot be undone.
  @Delete(':id')
  @Roles(Role.ADMIN)
  @HttpCode(204)
  remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthUser,
  ): Promise<void> {
    return this.devices.remove(id, actor);
  }
}
