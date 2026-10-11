import { Module } from '@nestjs/common';
import { EventsModule } from '../events/events.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

@Module({
  // Announces session changes to the user's open streams; records user.* events.
  imports: [RealtimeModule, EventsModule],
  controllers: [UsersController],
  providers: [UsersService],
})
export class UsersModule {}
