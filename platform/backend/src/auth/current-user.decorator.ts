import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { AuthUser } from '../users/user.select';
import type { AuthenticatedRequest } from './auth.types';

/** The user loaded by JwtAuthGuard. Only use on routes that are not @Public. */
export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthUser => {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (!request.user) {
      throw new Error(
        'CurrentUser used on a route without an authenticated user',
      );
    }
    return request.user;
  },
);
