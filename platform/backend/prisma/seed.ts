import path from 'node:path';
import { PrismaPg } from '@prisma/adapter-pg';
import { config } from 'dotenv';
import { hashPassword } from '../src/auth/password';
import { PrismaClient, Role } from '../src/generated/prisma/client';
import {
  isValidPassword,
  PASSWORD_RULE,
  USERNAME_PATTERN,
  USERNAME_RULE,
} from '../src/users/user.constraints';

// Creates the first ADMIN from ADMIN_USERNAME / ADMIN_PASSWORD when there are no users.
// Does nothing once any user exists, so it is safe to run repeatedly.

config({ path: path.resolve(__dirname, '..', '..', '.env'), quiet: true });

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} must be set (see .env.example)`);
  }
  return value;
}

async function main(): Promise<void> {
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: requireEnv('DATABASE_URL') }),
  });
  try {
    const userCount = await prisma.user.count();
    if (userCount > 0) {
      console.log(`Seed skipped: ${userCount} user(s) already exist.`);
      return;
    }

    const username = requireEnv('ADMIN_USERNAME');
    const password = requireEnv('ADMIN_PASSWORD');
    if (!USERNAME_PATTERN.test(username)) {
      throw new Error(`ADMIN_USERNAME invalid: ${USERNAME_RULE}`);
    }
    if (!isValidPassword(password)) {
      throw new Error(`ADMIN_PASSWORD invalid: ${PASSWORD_RULE}`);
    }

    await prisma.user.create({
      data: {
        username,
        passwordHash: await hashPassword(password),
        role: Role.ADMIN,
      },
    });
    console.log(`Seed: created ADMIN user "${username}".`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
