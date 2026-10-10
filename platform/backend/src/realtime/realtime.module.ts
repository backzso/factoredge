import { Module } from '@nestjs/common';
import { RealtimeService } from './realtime.service';

/** Bottom of the dependency graph: imports nothing, so anyone can publish. */
@Module({
  providers: [RealtimeService],
  exports: [RealtimeService],
})
export class RealtimeModule {}
