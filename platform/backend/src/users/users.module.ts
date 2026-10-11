import { Module } from '@nestjs/common';
import { RealtimeModule } from '../realtime/realtime.module';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

@Module({
  // Announces session changes to the user's open streams.
  imports: [RealtimeModule],
  controllers: [UsersController],
  providers: [UsersService],
})
export class UsersModule {}
