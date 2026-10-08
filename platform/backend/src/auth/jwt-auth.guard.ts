import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma/prisma.service';
import { authUserSelect } from '../users/user.select';
import {
  ACCESS_TOKEN_COOKIE,
  type AuthenticatedRequest,
  type JwtPayload,
} from './auth.types';
import { IS_PUBLIC_KEY } from './public.decorator';

/**
 * Global guard: every route requires a valid token unless marked @Public().
 * The user is re-loaded from the database on each request, so a deleted user's
 * token stops working immediately and the role always reflects the current DB value.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean | undefined>(
      IS_PUBLIC_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const token = extractToken(request);
    if (!token) {
      throw new UnauthorizedException();
    }

    let payload: JwtPayload;
    try {
      payload = await this.jwt.verifyAsync<JwtPayload>(token);
    } catch {
      throw new UnauthorizedException();
    }

    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      select: authUserSelect,
    });
    if (!user) {
      throw new UnauthorizedException();
    }

    request.user = user;
    return true;
  }
}

/** Cookie first (browser), then "Authorization: Bearer" (curl, scripts). */
function extractToken(request: AuthenticatedRequest): string | undefined {
  const cookies = request.cookies as Record<string, string> | undefined;
  const fromCookie = cookies?.[ACCESS_TOKEN_COOKIE];
  if (fromCookie) {
    return fromCookie;
  }
  const [scheme, value] = request.headers.authorization?.split(' ') ?? [];
  return scheme === 'Bearer' && value ? value : undefined;
}
