import { SetMetadata } from '@nestjs/common';
import type { Role } from '../generated/prisma/client';

export const ROLES_KEY = 'roles';

/** Restricts a route or controller to the given roles (checked by RolesGuard). */
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);
