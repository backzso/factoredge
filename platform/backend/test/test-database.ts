import path from 'node:path';
import { config } from 'dotenv';

/**
 * Resolves TEST_DATABASE_URL and refuses to continue unless the database name
 * ends with "_test": the e2e tests truncate every table.
 */
export function resolveTestDatabaseUrl(): string {
  config({ path: path.resolve(__dirname, '..', '..', '.env'), quiet: true });

  const url = process.env.TEST_DATABASE_URL;
  if (!url) {
    throw new Error('TEST_DATABASE_URL must be set to run the e2e tests');
  }
  const databaseName = new URL(url).pathname.replace(/^\//, '');
  if (!databaseName.endsWith('_test')) {
    throw new Error(
      `Refusing to run e2e tests against "${databaseName}": the database name must end with "_test"`,
    );
  }
  return url;
}
