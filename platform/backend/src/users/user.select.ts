import { Prisma } from '../generated/prisma/client';

// Every user query selects one of these explicitly, so passwordHash is never
// loaded outside the login path and cannot leak into a response.

export const authUserSelect = {
  id: true,
  username: true,
  role: true,
} satisfies Prisma.UserSelect;

export type AuthUser = Prisma.UserGetPayload<{ select: typeof authUserSelect }>;

export const publicUserSelect = {
  ...authUserSelect,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.UserSelect;

export type PublicUser = Prisma.UserGetPayload<{
  select: typeof publicUserSelect;
}>;
