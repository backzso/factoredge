import path from 'node:path';
import { config } from 'dotenv';
import { defineConfig } from 'prisma/config';

// Prisma 7 no longer loads .env by itself. The single env file lives in platform/.
// Variables already present in the environment win (e.g. the e2e setup's test DB URL).
config({ path: path.resolve(__dirname, '..', '.env'), quiet: true });

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'tsx prisma/seed.ts',
  },
  datasource: {
    url: process.env.DATABASE_URL,
  },
});
