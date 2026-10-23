import { spawnSync } from 'node:child_process';
import { getSafeTestDatabaseUrl } from './test-database-config';

function main() {
  const databaseUrl = getSafeTestDatabaseUrl();
  const prismaCli = require.resolve('prisma/build/index.js');
  const result = spawnSync(process.execPath, [prismaCli, 'migrate', 'deploy'], {
    env: { ...process.env, DATABASE_URL: databaseUrl },
    stdio: 'inherit',
  });

  if (result.error) throw result.error;
  if (result.status !== 0) process.exitCode = result.status ?? 1;
}

try {
  main();
} catch (error: unknown) {
  console.error(error instanceof Error ? error.message : 'Não foi possível preparar a base de teste.');
  process.exitCode = 1;
}
