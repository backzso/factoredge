import { Module } from '@nestjs/common';
import { RealtimeModule } from '../realtime/realtime.module';
import { DeviceEventRecorder } from './device-event-recorder.service';
import { EventsController } from './events.controller';
import { EventsService } from './events.service';

/** Depends only on RealtimeModule (and the global Prisma), so anyone above can record. */
@Module({
  imports: [RealtimeModule],
  controllers: [EventsController],
  providers: [EventsService, DeviceEventRecorder],
  exports: [EventsService],
})
export class EventsModule {}
