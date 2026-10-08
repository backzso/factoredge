import type { Request } from 'express';
import type { Role } from '../generated/prisma/client';
import type { AuthUser } from '../users/user.select';

export const ACCESS_TOKEN_COOKIE = 'access_token';

export interface JwtPayload {
  sub: string;
  role: Role;
}

export interface AuthenticatedRequest extends Request {
  user?: AuthUser;
}
