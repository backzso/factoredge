import { Module } from '@nestjs/common';
import { ConnectorsModule } from '../connectors/connectors.module';
import { DeviceHealthModule } from '../device-health/device-health.module';
import { EventsModule } from '../events/events.module';
import { DevicesController } from './devices.controller';
import { DevicesService } from './devices.service';

@Module({
  imports: [ConnectorsModule, DeviceHealthModule, EventsModule],
  controllers: [DevicesController],
  providers: [DevicesService],
})
export class DevicesModule {}
