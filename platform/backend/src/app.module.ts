import path from 'node:path';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AuthModule } from './auth/auth.module';
import { validateEnv } from './config/env.validation';
import { DevicesModule } from './devices/devices.module';
import { HealthModule } from './health/health.module';
import { PrismaModule } from './prisma/prisma.module';
import { StreamModule } from './realtime/stream.module';
import { UsersModule } from './users/users.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      // platform/.env, resolved the same way from src/ (tests) and dist/ (build).
      // Real environment variables take precedence over the file.
      envFilePath: path.resolve(__dirname, '..', '..', '.env'),
      validate: validateEnv,
    }),
    PrismaModule,
    AuthModule,
    UsersModule,
    HealthModule,
    DevicesModule,
    StreamModule,
  ],
})
export class AppModule {}
