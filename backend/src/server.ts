import { createDatabaseClient } from "./config/database";
import { readAuthConfig } from "./config/auth";
import { createApp } from "./app";
import { createAccountRepository } from "./repositories/accounts";
import { createAppointmentRepository } from './repositories/appointments';
import { createClinicalRepository } from './repositories/clinical';
import { readClinicConfig } from './config/clinic';

async function main() {
  const config = readAuthConfig();
  const database = createDatabaseClient();
  await database.$connect();
  const select = {
    id: true,
    name: true,
    email: true,
    passwordHash: true,
    role: true,
    status: true,
  } as const;
  const app = createApp(
    config,
    {
      findByEmail: (email) =>
        database.user.findUnique({ where: { email }, select }),
      findById: (id) => database.user.findUnique({ where: { id }, select }),
    },
    createAccountRepository(database),
    createAppointmentRepository(database),
    readClinicConfig(),
    createClinicalRepository(database),
  );
  const server = app.listen(Number(process.env.PORT) || 3333, () =>
    console.log("API OdontoTech iniciada."),
  );
  const shutdown = () =>
    server.close(() => {
      void database.$disconnect().finally(() => process.exit(0));
    });
  process.once("SIGTERM", shutdown);
  process.once("SIGINT", shutdown);
}
main().catch(() => {
  console.error(
    "Falha ao iniciar a API. Verifique JWT_SECRET (32 bytes aleatórios em hexadecimal), FRONTEND_ORIGIN e a conexão MySQL.",
  );
  process.exitCode = 1;
});
