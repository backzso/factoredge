import { ValidationPipe } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';

/** Shared by main.ts and the e2e tests so both run the same HTTP pipeline. */
export function configureApp(app: NestExpressApplication): void {
  // Responses should not advertise the framework.
  app.disable('x-powered-by');
  app.setGlobalPrefix('api');
  app.use(cookieParser());
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  // No CORS: the frontend is served from the same origin via the Vite dev proxy.
}
