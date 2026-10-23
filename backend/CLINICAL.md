# Prontuário clínico — Bloco 5

## Modelo e acesso

Foram reutilizados ClinicalRecord, ClinicalProcedure, ClinicalAddendum, Procedure e as relações existentes, sem modificar schema, seed ou migrations. Os nomes físicos são os nomes Prisma, sem @@map. ClinicalRecord.appointmentId já é UNIQUE.

O dentista só pode ler ou escrever nas consultas atribuídas ao seu próprio DentistProfile, ligado à identidade autenticada ativa com papel DENTIST. Os serviços verificam novamente o vínculo dentro da transação. O paciente é identificado pela sessão e só lê os seus próprios registos finalizados. Não existe patientId livre para ampliar o âmbito.

ADMIN e RECEPTIONIST não recebem acesso clínico: não havia política explícita autorizando administradores a ler prontuários. A agenda e a gestão administrativa mantêm as permissões anteriores. Na visão profissional, o histórico do paciente contém apenas registos de consultas desse dentista; não existe acesso cruzado ao histórico de colegas. Os pacientes recebem notas, procedimentos e aditamentos dos seus registos finalizados.

## Rotas

Todas exigem a autenticação existente. Respostas usam Cache-Control: no-store. Escritas mantêm Origin exata e X-OdontoTech-CSRF. IDs dos caminhos são IDs de consulta, não de prontuário.

| Método e caminho | Operação / acesso |
| --- | --- |
| GET /clinical/appointments/:id | Contexto autorizado do paciente/consulta, registo ou null e fuso. Dentista responsável. Nunca cria dados. |
| POST /clinical/appointments/:id | Corpo `{}`. Inicia rascunho explicitamente ou devolve o já existente sem duplicar. Dentista responsável. |
| PATCH /clinical/appointments/:id | `notes` e `expectedUpdatedAt`. Guarda notas em rascunho. |
| POST /clinical/appointments/:id/procedures | Acrescenta procedimento ao rascunho; devolve o registo atualizado. |
| POST /clinical/appointments/:id/finalize | `expectedUpdatedAt`. Finalização explícita e irreversível pelas rotas normais. |
| POST /clinical/appointments/:id/addenda | `content`. Acrescenta aditamento a um registo finalizado. |
| GET /clinical/appointments/:id/history | Histórico desse paciente limitado às consultas do dentista autenticado. |
| GET /clinical/history | Histórico próprio finalizado do paciente autenticado. |
| GET /clinical/catalog | Catálogo ativo para dentistas, seleção id/nome. |

Histórico usa page (a partir de 1), pageSize (padrão 10, máximo 50), hasMore e ordenação por data da consulta decrescente e ID de registo decrescente. O catálogo também aceita search (máximo 100 caracteres); não foram criadas rotas de gestão do catálogo nem novos dados de seed. Se o catálogo estiver vazio, o formulário permite registo manual.

## Regras de escrita

- Rascunho só pode ser iniciado, alterado, receber procedimentos e ser finalizado em IN_PROGRESS ou COMPLETED. COMPLETED permite documentar após o encerramento operacional. Os restantes estados não permitem essas escritas. Um registo existente permanece legível para o responsável mesmo que a consulta esteja cancelada; nenhum cancelamento elimina conteúdo.
- A criação começa com notas vazias. O autor vem da sessão, não do cliente. A finalização exige notas não vazias e pelo menos um procedimento. Registo finalizado tem timestamp real, mantém autor/conteúdo e não altera o estado da consulta.
- Notas: até 4000 caracteres; aditamento: 1–4000; região: 1–80; nome manual: 1–191; descrição e notas de procedimento: até 2000 cada. A API clínica admite corpo JSON até 32kb, sem aumentar o limite dos outros módulos. Campos desconhecidos e autoria/IDs internos são rejeitados.
- Procedimento requer expectedUpdatedAt, toothOrRegion e procedureId ativo ou procedureName manual. O nome do catálogo é obtido no servidor, mesmo que um cliente envie também um nome. O snapshot da descrição usa a descrição realizada enviada ou a descrição do catálogo. Alterações futuras no catálogo não modificam os snapshots guardados. Região é texto descritivo limitado (ex.: 16, arcada superior), não um odontograma gráfico.
- Não há PATCH ou DELETE de procedimentos nem de aditamentos. Um registo finalizado não aceita notas, novos procedimentos ou nova finalização. Correções são aditamentos append-only do responsável, com autor e data reais. Criar um aditamento não altera notes, authorId, finalizedAt, updatedAt ou procedimentos originais.

## Transações e concorrência

Todas as escritas bloqueiam, na mesma ordem da agenda: DentistProfile, Appointment, ClinicalRecord. Os SELECT ... FOR UPDATE parametrizados e a verificação/escrita executam dentro de uma transação Prisma READ COMMITTED (maxWait 5s, timeout 10s). A linha da consulta serializa também duas criações quando ainda não existe prontuário. A restrição UNIQUE é uma proteção adicional, não o único mecanismo.

Depois de obter os locks, a consulta e o registo são relidos e as permissões/estados revalidados. A agenda já não permite editar/reassociar consultas IN_PROGRESS ou COMPLETED. Se o dentista divergir da leitura inicial, a operação clínica é recusada.

Guardar notas, adicionar procedimento e finalizar requerem expectedUpdatedAt, timestamp UTC ISO com milissegundos devolvido pelo servidor. Cada alteração de rascunho incrementa updatedAt de forma monotónica, inclusive dentro do mesmo milissegundo. Uma versão obsoleta recebe 409, sem sobrescrita. Os locks impedem que uma edição posterior ao lock da finalização modifique conteúdo já finalizado; se a edição confirmar primeiro, a finalização com versão antiga recebe 409 e exige revisão.

P2002, P2034, P2028 e timeouts/deadlocks MySQL 1205/1213 são tratados com 409 controlado; relações inválidas e registo inexistente com 400/404. Erros inesperados mantêm a resposta e o log genéricos existentes, sem conteúdo clínico ou SQL.

A imutabilidade é da aplicação: SQL direto com privilégios administrativos pode tecnicamente alterar dados. Scripts/importações e futuras rotas devem respeitar este protocolo. Não há assinatura digital, certificação externa ou garantia contra administradores da base.

## Interface e privacidade

A agenda do dentista oferece Prontuário, em /prontuario/:appointmentId. A página mostra identificação/contacto autorizado, contexto da consulta, rascunho, procedimentos, finalização confirmada visualmente, aditamentos e histórico paginado. Na área do paciente há O meu histórico clínico, em /paciente/historico, apenas de leitura. Admin e recepção não recebem navegação clínica.

Datas de consulta, finalização e aditamentos usam o fuso central da clínica; timestamps persistidos continuam UTC. O nascimento é apresentado como data civil, sem conversão de fuso.

Notas não são gravadas em localStorage/sessionStorage, URLs, mensagens de erro ou telemetria. São texto React, não HTML interpretado. Sessão expirada desmonta a página através do comportamento de autenticação existente. Requisições de leitura antigas são canceladas ao mudar de contexto. A interface bloqueia submissões repetidas e mantém notas locais em erro/conflito; recarregar com alterações não guardadas exige confirmação de descarte. Guardar rascunho e finalizar são ações separadas.

## Verificação

- `npm test`: testes HTTP/serviços/repositório com mocks, React e regressões anteriores.
- `node --import tsx --test backend/tests/clinical.mysql.test.ts`: integração MySQL real isolada.
- `npm run build`: TypeScript e builds dos dois projetos.
- `git diff --check`: revisão de espaços/conflitos.

O teste MySQL usa somente TEST_DATABASE_URL explícita ou DATABASE_URL de backend/.env.test, com host local e nome odontotech_test ou odontotech_test_<sufixo>. Nunca utiliza DATABASE_URL de desenvolvimento como fallback. Confirma InnoDB, cria fixtures próprias e remove apenas essas fixtures no final. Sem URL isolada, é omitido explicitamente; configuração insegura falha. Não executa reset, db push ou migrations.

Os mocks cobrem autorização, CSRF, campos proibidos, estados, snapshots, conflitos de versão, finalização, aditamentos, rollback lógico e respostas sem dados internos. O MySQL real comprova unicidade com início concorrente, rollback de procedimento depois de falha, snapshots após mudança de catálogo, bloqueio de notas/procedimentos durante finalização, preservação do original ao acrescentar aditamento, âmbito do histórico e leitura HTTP através da API/Prisma.

A revisão visual usa uma API temporária na porta 3335 e frontend na 5175, ligados somente à base isolada, sem interferir nos servidores de desenvolvimento. Fluxo verificado: login dentista → agenda → prontuário → iniciar → guardar → procedimento → confirmar finalização → aditamento → login paciente → histórico finalizado. Nenhum dado clínico real é utilizado. O teste visual desktop não substitui uma auditoria completa de acessibilidade nem validação mobile em dispositivos reais.

Não há lint configurado. Financeiro, odontograma gráfico, exportação, partilha pública, assinaturas digitais e gestão de catálogo ficam fora deste bloco.
