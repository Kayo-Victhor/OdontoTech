import { config } from 'dotenv';
import { resolve } from 'node:path';
import { PrismaClient } from '@prisma/client';

config({ path: resolve(__dirname, '../../.env'), quiet: true });

export function getDatabaseUrl(): string {
  if (process.env.DATABASE_URL) {
    try {
      const url = new URL(process.env.DATABASE_URL);
      if (url.protocol !== 'mysql:' || !url.hostname || url.pathname.length <= 1) {
        throw new Error();
      }
    } catch {
      throw new Error('DATABASE_URL deve ser uma URL MySQL válida com o nome da base de dados.');
    }
    return process.env.DATABASE_URL;
  }

  for (const key of ['DB_HOST', 'DB_USER', 'DB_NAME']) {
    if (!process.env[key]?.trim()) throw new Error(`Configure ${key} ou DATABASE_URL em backend/.env.`);
  }
  if (process.env.DB_PASSWORD === undefined) throw new Error('Configure DB_PASSWORD em backend/.env (pode ser vazio em desenvolvimento local).');
  const port = Number(process.env.DB_PORT || '3306');
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('DB_PORT deve ser uma porta válida.');

  const url = new URL('mysql://localhost');
  url.hostname = process.env.DB_HOST!;
  url.port = String(port);
  url.username = process.env.DB_USER!;
  url.password = process.env.DB_PASSWORD;
  url.pathname = `/${encodeURIComponent(process.env.DB_NAME!)}`;
  url.searchParams.set('connect_timeout', '5');
  return url.toString();
}

export function createDatabaseClient(): PrismaClient {
  return new PrismaClient({ datasourceUrl: getDatabaseUrl() });
}
