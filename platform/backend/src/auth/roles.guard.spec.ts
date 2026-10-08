import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Role } from '../generated/prisma/client';
import type { AuthUser } from '../users/user.select';
import { Public } from './public.decorator';
import { Roles } from './roles.decorator';
import { RolesGuard } from './roles.guard';

// Real decorators + real Reflector: the test exercises the same metadata lookup as the app.
class OpenController {
  @Public()
  publicRoute() {}

  anyUserRoute() {}

  @Roles(Role.ADMIN)
  adminRoute() {}

  @Roles(Role.ADMIN, Role.VIEWER)
  adminOrViewerRoute() {}
}

@Roles(Role.ADMIN)
class AdminController {
  inheritedRoute() {}

  @Roles(Role.VIEWER)
  overriddenRoute() {}
}

const admin: AuthUser = { id: 'a', username: 'admin', role: Role.ADMIN };
const viewer: AuthUser = { id: 'v', username: 'viewer', role: Role.VIEWER };

function contextFor(
  controller: new () => object,
  handlerName: string,
  user?: AuthUser,
): ExecutionContext {
  const handler = (controller.prototype as Record<string, () => void>)[
    handlerName
  ];
  return {
    getHandler: () => handler,
    getClass: () => controller,
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  } as unknown as ExecutionContext;
}

describe('RolesGuard', () => {
  const guard = new RolesGuard(new Reflector());

  it('allows @Public routes without a user', () => {
    expect(guard.canActivate(contextFor(OpenController, 'publicRoute'))).toBe(
      true,
    );
  });

  it('allows routes without @Roles for any authenticated user', () => {
    expect(
      guard.canActivate(contextFor(OpenController, 'anyUserRoute', viewer)),
    ).toBe(true);
  });

  it('allows a user whose role is required', () => {
    expect(
      guard.canActivate(contextFor(OpenController, 'adminRoute', admin)),
    ).toBe(true);
  });

  it('denies a user whose role is not required (403)', () => {
    expect(
      guard.canActivate(contextFor(OpenController, 'adminRoute', viewer)),
    ).toBe(false);
  });

  it('accepts any of several required roles', () => {
    expect(
      guard.canActivate(
        contextFor(OpenController, 'adminOrViewerRoute', viewer),
      ),
    ).toBe(true);
  });

  it('applies class-level @Roles to every handler', () => {
    expect(
      guard.canActivate(contextFor(AdminController, 'inheritedRoute', viewer)),
    ).toBe(false);
    expect(
      guard.canActivate(contextFor(AdminController, 'inheritedRoute', admin)),
    ).toBe(true);
  });

  it('lets handler-level @Roles override the class-level one', () => {
    expect(
      guard.canActivate(contextFor(AdminController, 'overriddenRoute', viewer)),
    ).toBe(true);
    expect(
      guard.canActivate(contextFor(AdminController, 'overriddenRoute', admin)),
    ).toBe(false);
  });

  it('throws 401 when a role is required but no user is attached', () => {
    expect(() =>
      guard.canActivate(contextFor(OpenController, 'adminRoute')),
    ).toThrow(UnauthorizedException);
  });
});
