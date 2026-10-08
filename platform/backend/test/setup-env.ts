import { resolveTestDatabaseUrl } from './test-database';

// Runs before each test file: point the app at the test database.
// Real environment variables take precedence over platform/.env in ConfigModule.
process.env.DATABASE_URL = resolveTestDatabaseUrl();
process.env.NODE_ENV = 'test';
