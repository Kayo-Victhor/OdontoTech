import { createDatabaseClient } from '../config/database';

async function main() {
  const database = createDatabaseClient();
  try {
    await database.$connect();
    const rows = await database.$queryRaw<Array<{ connected: number | bigint }>>`SELECT 1 AS connected`;
    if (Number(rows[0]?.connected) !== 1) throw new Error('A consulta de teste não retornou o resultado esperado.');
    console.log('Conexão com MySQL confirmada. Consulta SELECT 1 executada com sucesso.');
  } finally {
    await database.$disconnect();
  }
}

main().catch((error: unknown) => {
  const code = typeof error === 'object' && error !== null && 'errorCode' in error
    ? String(error.errorCode) : undefined;
  const messages: Record<string, string> = {
    P1000: 'MySQL recusou as credenciais. Verifique o utilizador e a palavra-passe.',
    P1001: 'Não foi possível alcançar o MySQL. Verifique o serviço, host e porta.',
    P1002: 'O MySQL não respondeu a tempo.',
    P1003: 'A base de dados configurada não existe. Crie-a no MySQL ou ajuste o nome no ambiente.',
    P1010: 'O utilizador não tem permissão para acessar esta base de dados.',
  };
  // Nunca imprimir erros do driver: podem conter a URL com credenciais.
  const message = code ? messages[code] || `Falha na conexão MySQL (${code}).`
    : error instanceof Error && /^(Configure |DB_PORT |DATABASE_URL )/.test(error.message)
      ? error.message : 'Falha na conexão MySQL. Verifique a configuração em backend/.env.';
  console.error(message);
  process.exitCode = 1;
});
