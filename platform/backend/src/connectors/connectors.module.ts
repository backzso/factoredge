import { Module } from '@nestjs/common';
import { DeviceHealthModule } from '../device-health/device-health.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { TelemetryModule } from '../telemetry/telemetry.module';
import {
  CONNECTOR_FACTORY,
  ConnectorManager,
} from './connector-manager.service';
import { createConnector } from './connector.factory';

@Module({
  imports: [TelemetryModule, DeviceHealthModule, RealtimeModule],
  providers: [
    ConnectorManager,
    { provide: CONNECTOR_FACTORY, useValue: createConnector },
  ],
  exports: [ConnectorManager],
})
export class ConnectorsModule {}
