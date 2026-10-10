import { Module } from '@nestjs/common';
import { DeviceHealthModule } from '../device-health/device-health.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { ReadingsController } from './readings.controller';
import { TelemetryService } from './telemetry.service';

@Module({
  imports: [DeviceHealthModule, RealtimeModule],
  controllers: [ReadingsController],
  providers: [TelemetryService],
  exports: [TelemetryService],
})
export class TelemetryModule {}
