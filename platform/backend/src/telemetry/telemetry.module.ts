import { Module } from '@nestjs/common';
import { DeviceHealthModule } from '../device-health/device-health.module';
import { EventsModule } from '../events/events.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { ReadingsController } from './readings.controller';
import { TelemetryService } from './telemetry.service';
import { TemperatureAlarmService } from './temperature-alarm.service';

@Module({
  imports: [DeviceHealthModule, RealtimeModule, EventsModule],
  controllers: [ReadingsController],
  providers: [TelemetryService, TemperatureAlarmService],
  exports: [TelemetryService],
})
export class TelemetryModule {}
