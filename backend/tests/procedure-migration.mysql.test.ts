import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse } from 'dotenv';
import { createConnection } from 'mysql2/promise';

const file = resolve(__dirname, '../.env.test');
const testUrl = process.env.TEST_DATABASE_URL || (existsSync(file) ? parse(readFileSync(file)).DATABASE_URL : undefined);
test('MySQL isolado: SQL incremental preserva dados antigos e não inventa preço', { skip: !testUrl && 'MySQL isolado não configurado; migration não verificada com dados legados.' }, async () => {
  const url = new URL(testUrl!); assert.ok(url.protocol === 'mysql:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) && /^odontotech_test(?:_[a-z0-9_]+)?$/.test(decodeURIComponent(url.pathname.slice(1))));
  const connection = await createConnection(testUrl!);
  try {
    // Tabela TEMPORARY privada desta conexão, não a tabela Procedure da aplicação.
    await connection.query('CREATE TEMPORARY TABLE odt_catalog_migration_probe (id VARCHAR(191) PRIMARY KEY, name VARCHAR(191) NOT NULL, description TEXT NULL, estimatedDurationMinutes INT NOT NULL, isActive BOOLEAN NOT NULL, createdAt DATETIME(3) NOT NULL, updatedAt DATETIME(3) NOT NULL) ENGINE=InnoDB');
    await connection.execute('INSERT INTO odt_catalog_migration_probe VALUES (?, ?, ?, ?, ?, ?, ?)', ['legacy-id', 'Nome legado', 'Descrição legada', 45, true, '2020-01-01 00:00:00.000', '2020-01-02 00:00:00.000']);
    const [before] = await connection.query<any[]>('SELECT * FROM odt_catalog_migration_probe');
    const sql = readFileSync(resolve(__dirname, '../prisma/migrations/20261023000200_procedure_default_price/migration.sql'), 'utf8');
    assert.ok(!/\b(DROP|DELETE|TRUNCATE|UPDATE)\b/i.test(sql));
    await connection.query(sql.replaceAll('`Procedure`', '`odt_catalog_migration_probe`'));
    const [after] = await connection.query<any[]>('SELECT * FROM odt_catalog_migration_probe');
    const { defaultPrice, ...rest } = after[0]; assert.equal(defaultPrice, null); assert.deepEqual(rest, before[0]);
    await connection.query('UPDATE odt_catalog_migration_probe SET estimatedDurationMinutes = NULL');
    const [optional] = await connection.query<any[]>('SELECT estimatedDurationMinutes FROM odt_catalog_migration_probe'); assert.equal(optional[0].estimatedDurationMinutes, null);
  } finally { await connection.query('DROP TEMPORARY TABLE IF EXISTS odt_catalog_migration_probe'); await connection.end(); }
});
