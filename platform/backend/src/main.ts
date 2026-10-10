import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { configureApp } from './app.setup';
import { EnvironmentVariables } from './config/env.validation';
import { armShutdownDeadline } from './lifecycle/shutdown-deadline';
import {
  SHUTDOWN_SIGNALS,
  SHUTDOWN_TIMEOUT_MS,
} from './lifecycle/shutdown.constants';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  configureApp(app);
  // useProcessExit: exit with process.exit(0) after the hooks instead of
  // re-raising the signal, which our own SIGINT/SIGTERM listener would catch.
  app.enableShutdownHooks([...SHUTDOWN_SIGNALS], { useProcessExit: true });
  armShutdownDeadline(SHUTDOWN_SIGNALS, SHUTDOWN_TIMEOUT_MS);

  const config = app.get(ConfigService<EnvironmentVariables, true>);
  await app.listen(config.get('PORT', { infer: true }));
}

void bootstrap();
