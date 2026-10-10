import { Prisma } from '../generated/prisma/client';

function hasCode(error: unknown, code: string): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError && error.code === code
  );
}

/** Unique constraint violation. */
export function isUniqueViolation(error: unknown): boolean {
  return hasCode(error, 'P2002');
}

/** Foreign key constraint violation (e.g. a reading for a device that was just deleted). */
export function isForeignKeyViolation(error: unknown): boolean {
  return hasCode(error, 'P2003');
}

/** update/delete found no row to act on. */
export function isRecordNotFound(error: unknown): boolean {
  return hasCode(error, 'P2025');
}
