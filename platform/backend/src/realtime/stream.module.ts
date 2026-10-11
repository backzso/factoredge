import { Module } from '@nestjs/common';
import { DeviceHealthModule } from '../device-health/device-health.module';
import { TelemetryModule } from '../telemetry/telemetry.module';
import { RealtimeModule } from './realtime.module';
import { SessionWatchService } from './session-watch.service';
import { StreamController } from './stream.controller';

/**
 * Kept apart from RealtimeModule: the snapshot needs telemetry and device health,
 * which themselves depend on RealtimeModule. Splitting avoids a module cycle.
 */
@Module({
  imports: [RealtimeModule, TelemetryModule, DeviceHealthModule],
  controllers: [StreamController],
  providers: [SessionWatchService],
})
export class StreamModule {}
