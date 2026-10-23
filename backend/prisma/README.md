# Regras operacionais necessárias

O schema preserva integridade referencial e índices de consulta, mas MySQL não possui uma restrição declarativa para impedir intervalos de agendamentos sobrepostos.

O serviço de agendamentos deve validar `endAt > startAt` e, numa transação com bloqueio apropriado, consultar os compromissos do mesmo dentista que se sobreponham ao intervalo solicitado. Estados `CANCELLED` não bloqueiam a agenda. A aplicação deverá também validar os perfis conforme o papel do utilizador e a imutabilidade de prontuários finalizados.

O escopo atual contém utilizadores, pacientes, dentistas, procedimentos, agendamentos e prontuários. O catálogo Procedure inclui defaultPrice Decimal(10,2) opcional e estimatedDurationMinutes opcional. O administrador configura preços pela API/interface; null significa preço não configurado, distinto de zero. Orçamentos persistidos, parcelas devidas e pagamentos continuam fora desta etapa.

## Migration do catálogo (Bloco 6.1)

A migration incremental 20261023000200_procedure_default_price adiciona somente defaultPrice nullable e permite duração null. Não preenche preços, não remove IDs/relações e não recria a migration inicial. Foi validada no MySQL isolado e aplicada à base local de desenvolvimento, com verificação de preservação dos registros. Não foi aplicada em produção.

Em outra instalação, confira a base de destino e aplique as migrations versionadas com `npm exec --workspace backend -- prisma migrate deploy` a partir da raiz. Gere o cliente com `npm run prisma:generate --workspace backend`. Não use reset ou db push. Mais detalhes em [Catálogo e simulação](../BUDGETS.md).

## Base de teste

Crie `backend/.env.test` com uma `DATABASE_URL` própria. Por segurança, o nome da base precisa conter a palavra `test`.

- `npm run db:test:setup`: aplica as migrações pendentes e confirma a conexão.
- `npm run db:test:migrate`: aplica somente as migrações.
- `npm run db:test`: executa somente a verificação de conexão.

Esses comandos carregam `backend/.env.test` explicitamente e não reutilizam a URL de `backend/.env`.
