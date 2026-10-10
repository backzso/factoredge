import { Module } from '@nestjs/common';
import { RealtimeModule } from '../realtime/realtime.module';
import { DeviceHealthService } from './device-health.service';

@Module({
  imports: [RealtimeModule],
  providers: [DeviceHealthService],
  exports: [DeviceHealthService],
})
export class DeviceHealthModule {}
