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
import { Roles } from '../auth/roles.decorator';
import { Role } from '../generated/prisma/client';
import { type DeviceView, DevicesService } from './devices.service';
import { CreateDeviceDto } from './dto/create-device.dto';
import { UpdateDeviceDto } from './dto/update-device.dto';

/** Reads are open to any logged-in user; writes are ADMIN only. */
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
  @Roles(Role.ADMIN)
  create(@Body() dto: CreateDeviceDto): Promise<DeviceView> {
    return this.devices.create(dto);
  }

  @Patch(':id')
  @Roles(Role.ADMIN)
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateDeviceDto,
  ): Promise<DeviceView> {
    return this.devices.update(id, dto);
  }

  @Delete(':id')
  @Roles(Role.ADMIN)
  @HttpCode(204)
  remove(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.devices.remove(id);
  }
}
