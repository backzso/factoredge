import { Module } from '@nestjs/common';
import { ConnectionReaper } from './connection-reaper.service';

@Module({
  providers: [ConnectionReaper],
})
export class LifecycleModule {}
