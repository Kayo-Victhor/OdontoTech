const TEST_DATABASE_NAME = /(^|[_-])test([_-]|$)/i;

export function getSafeTestDatabaseUrl(): string {
  const value = process.env.DATABASE_URL;
  if (!value) {
    throw new Error('Configure DATABASE_URL em backend/.env.test.');
  }

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('DATABASE_URL em backend/.env.test deve ser uma URL MySQL válida.');
  }

  const databaseName = decodeURIComponent(url.pathname.slice(1));
  if (url.protocol !== 'mysql:' || !url.hostname || !databaseName) {
    throw new Error('DATABASE_URL em backend/.env.test deve apontar para uma base MySQL.');
  }
  if (!TEST_DATABASE_NAME.test(databaseName)) {
    throw new Error(`A base de teste deve ter "test" no nome; recebido: ${databaseName}.`);
  }

  return value;
}
