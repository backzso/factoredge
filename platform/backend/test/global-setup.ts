import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { resolveTestDatabaseUrl } from './test-database';

/** Brings the test database to the latest migration once per test run. */
export default function globalSetup(): void {
  const backendRoot = path.resolve(__dirname, '..');
  execFileSync(
    path.join(backendRoot, 'node_modules', '.bin', 'prisma'),
    ['migrate', 'deploy'],
    {
      cwd: backendRoot,
      env: { ...process.env, DATABASE_URL: resolveTestDatabaseUrl() },
      stdio: 'inherit',
    },
  );
}
