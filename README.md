# OdontoTech

Sistema web para gestão de clínicas odontológicas, com API REST e interface responsiva. O estado atual contempla autenticação, cadastro de pacientes, gestão administrativa de contas, agenda, prontuário clínico e simulação transitória de orçamentos.

**Atualizado em:** 23/10/2026 — após a implementação do Bloco 6.1.

O projeto está em desenvolvimento. As funcionalidades descritas abaixo estão implementadas no código local; isso não significa que exista uma implantação de produção ou que o sistema tenha sido homologado para utilização clínica real.

## 1. Estado atual

| Módulo | Situação |
| --- | --- |
| Estrutura e ambiente | Backend e frontend separados, npm workspaces e inicialização conjunta. |
| Banco de dados | MySQL com Prisma, migration inicial, migration incremental do catálogo e seed do administrador. PostgreSQL não é utilizado. |
| Autenticação | Login, logout, restauração de sessão, cookie HttpOnly, JWT e autorização por perfil. |
| Cadastro de pacientes | Cadastro público integrado ao login, validação de dados e criação de PatientProfile. |
| Gestão de utilizadores | Administrador cria dentistas/rececionistas e consulta contas com paginação. |
| Catálogo de procedimentos | ADMIN cadastra/edita nome, descrição, preço Decimal, duração opcional e disponibilidade no MySQL; sem exclusão física. |
| Agenda | Criação, listagem diária, filtros, detalhes, edição, cancelamento e transições de estado. |
| Integridade da agenda | Bloqueios transacionais no MySQL para impedir sobreposição por dentista. |
| Prontuário | Rascunhos, notas, procedimentos, snapshots históricos, finalização e aditamentos. |
| Histórico do paciente | Consulta pessoal, paginada e apenas de registos finalizados. |
| Simulação de orçamentos | Seleção de paciente/procedimentos, cálculo Decimal no backend, comparação de parcelas e resumo imprimível, sem persistência ou obrigações financeiras. |
| Financeiro | Não implementado; sem orçamentos, faturação, parcelas ou pagamentos no schema atual. |

As páginas iniciais de cada perfil são áreas simples de navegação. Não são dashboards completos com métricas ou relatórios.

## 2. Tecnologias e estrutura

- Backend: Node.js, Express e TypeScript.
- Persistência: MySQL/InnoDB e Prisma ORM.
- Frontend: React, Vite, TypeScript, TailwindCSS e React Router.
- Segurança: JWT em cookie HttpOnly, Argon2id, proteção CSRF, CORS e limitação de tentativas no login/cadastro.
- Datas: Luxon, timestamps UTC e apresentação no fuso configurado da clínica.
- Testes: Node Test Runner, Supertest, Vitest, Testing Library e integração com MySQL isolado.

```text
OdontoTech/
├── backend/
│   ├── prisma/             # Schema, migrations versionadas e seed
│   ├── src/
│   │   ├── config/         # Banco, autenticação e horários da clínica
│   │   ├── middlewares/    # Autenticação, autorização, CSRF e rate limiting
│   │   ├── repositories/   # Acesso ao banco e transações
│   │   ├── routes/         # Endpoints da API
│   │   ├── scripts/        # Conexão e preparação da base de testes
│   │   ├── services/       # Regras de negócio
│   │   ├── validators/     # Validação de entradas
│   │   ├── app.ts          # Configuração da aplicação Express
│   │   └── server.ts       # Inicialização da API
│   └── tests/
├── frontend/
│   ├── src/
│   │   ├── auth/           # Sessão e perfis
│   │   ├── components/     # Formulários, diálogos e histórico
│   │   ├── pages/          # Login, cadastro, gestão, agenda e prontuário
│   │   ├── services/       # Cliente HTTP e contratos da API
│   │   └── App.tsx         # Rotas e acesso às páginas
│   └── tests/
├── package.json            # Workspaces e comandos conjuntos
└── README.md
```

O schema contém User, PatientProfile, DentistProfile, Procedure, Appointment, ClinicalRecord, ClinicalProcedure e ClinicalAddendum. A agenda e o prontuário reutilizaram os modelos iniciais. O Bloco 6.1 acrescentou uma migration incremental para Procedure.defaultPrice (Decimal opcional) e duração opcional, preservando IDs e relações, sem preencher preços artificiais.

## 3. Perfis e permissões

| Perfil | Acesso atual |
| --- | --- |
| ADMIN | Gestão de contas, catálogo/preços e operações da agenda. Sem acesso ao conteúdo clínico. |
| RECEPTIONIST | Operações da agenda. Sem acesso ao conteúdo clínico. |
| DENTIST | Consultas próprias, início/conclusão do atendimento, prontuários autorizados e simulação de orçamentos para pacientes vinculados. |
| PATIENT | Consultas próprias e histórico clínico próprio finalizado, apenas de leitura. |

A autorização é aplicada no backend. Os seletores do login e os parâmetros enviados pelo navegador não concedem permissões. A identidade e o papel atual são confirmados na conta autenticada.

O cadastro público cria apenas pacientes. O administrador é criado pelo seed; a gestão administrativa cria apenas dentistas e rececionistas. Não há interface de eliminação, suspensão ou alteração de papel de contas.

## 4. Executar localmente

O ambiente da última validação utilizou Node.js 22.23.1 e npm 10.9.8. É necessário um servidor MySQL disponível, com a base e as permissões de acesso configuradas.

### Dependências e configuração

Na raiz:

```sh
npm ci
```

Crie `backend/.env` a partir de [backend/.env.example](backend/.env.example), preenchendo os valores privados localmente. Para o frontend, [frontend/.env.example](frontend/.env.example) documenta a configuração opcional; por padrão, o cliente usa `/api`.

Principais variáveis do backend:

| Variável | Finalidade / padrão |
| --- | --- |
| DATABASE_URL | URL MySQL com utilizador, senha, host, porta e base. Use este formato também nas operações Prisma. |
| JWT_SECRET | Segredo privado aleatório em hexadecimal, com pelo menos 64 caracteres. Obrigatório para iniciar a API. |
| FRONTEND_ORIGIN | Origem exata permitida; localmente `http://localhost:5173`, sem caminho ou barra final. |
| PORT | Porta da API; padrão 3333. |
| JWT_EXPIRES_IN_SECONDS | Duração da sessão; padrão 3600 segundos. |
| ADMIN_NAME / ADMIN_EMAIL / ADMIN_PASSWORD | Dados utilizados exclusivamente na execução do seed administrativo. |
| LOGIN_RATE_LIMIT_MAX / LOGIN_RATE_LIMIT_WINDOW_MS | Padrões: 10 tentativas por 900000 ms. |
| REGISTER_RATE_LIMIT_MAX / REGISTER_RATE_LIMIT_WINDOW_MS | Padrões: 5 tentativas por 900000 ms. |
| CLINIC_TIMEZONE | Fuso de apresentação; padrão `America/Sao_Paulo`. |
| AGENDA_START_HOUR / AGENDA_END_HOUR | Limites de apresentação; padrões 8 e 18. |
| AGENDA_SLOT_MINUTES | Intervalo da grelha; padrão 60 minutos. |

O cliente do backend também aceita DB_HOST, DB_PORT, DB_USER, DB_PASSWORD e DB_NAME como alternativa de conexão, com prioridade para DATABASE_URL. Para evitar divergências com a CLI Prisma, prefira configurar DATABASE_URL no ambiente de desenvolvimento.

Para gerar o segredo da sessão localmente:

```sh
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

Não reutilize a senha MySQL como segredo JWT. Não versione ficheiros `.env`, senhas ou credenciais reais.

### Banco e administrador inicial

Numa instalação nova de desenvolvimento, depois de criar a base MySQL e conferir o ambiente de destino:

```sh
npm run prisma:generate --workspace backend
npm exec --workspace backend -- prisma migrate deploy
npm run prisma:seed --workspace backend
```

Não é necessário repetir a configuração inicial numa base já preparada. O seed preserva as credenciais e o estado de um administrador existente com o e-mail configurado; não promove outra conta nem redefine a senha automaticamente.

Não execute reset, recriação da base ou db push para preparar uma instalação existente. Não use os comandos de desenvolvimento em produção.

### Iniciar a aplicação

```sh
npm run dev
```

- Frontend: `http://localhost:5173`.
- API: `http://localhost:3333`.
- Verificação básica da API: `GET http://localhost:3333/health`.

O Vite encaminha `/api` para a API local. Use `localhost` de forma consistente com FRONTEND_ORIGIN; trocar por `127.0.0.1` altera a origem. Se mudar a porta da API, ajuste também o proxy em `frontend/vite.config.ts`. VITE_API_URL permite configurar outra base HTTP, mas não substitui a configuração de origem e cookies do backend.

Também existem `npm run dev:backend` e `npm run dev:frontend` para iniciar os projetos separadamente.

## 5. Navegação e fluxos disponíveis

| Caminho | Página |
| --- | --- |
| /login | Autenticação. |
| /registro | Cadastro público de paciente, com senha e confirmação. |
| /admin, /recepcao, /dentista, /paciente | Área inicial do perfil. |
| /admin/utilizadores | Criação e listagem administrativa de contas. |
| /admin/procedimentos | Gestão administrativa de procedimentos e preços no MySQL. |
| /agenda | Agenda autorizada para cada perfil. |
| /prontuario/:appointmentId | Prontuário do dentista responsável pela consulta. |
| /dentista/orcamentos | Simulação de orçamentos, exclusiva do dentista, sem gravação de orçamento. |
| /paciente/historico | Histórico pessoal finalizado do paciente. |

### Agenda

Admin e recepção selecionam pacientes e dentistas reais da API para criar agendamentos. O backend valida perfis, intervalo e sobreposição, incluindo requisições simultâneas.

Consultas consecutivas são permitidas. Consultas canceladas libertam o intervalo; concluídas e faltas continuam a bloquear sobreposições retroativas. O cancelamento preserva o registo.

Transições atuais:

- SCHEDULED → CONFIRMED ou CANCELLED.
- CONFIRMED → WAITING, CANCELLED ou NO_SHOW.
- WAITING → IN_PROGRESS ou CANCELLED.
- IN_PROGRESS → COMPLETED.
- COMPLETED, CANCELLED e NO_SHOW são terminais.

O dentista só inicia e conclui as próprias consultas. O paciente não modifica agendamentos. Horários parcialmente ocupados não aparecem como livres; os limites da grelha não impedem a API de aceitar horários válidos fora da apresentação padrão.

### Prontuário

O dentista abre **Prontuário** na agenda. Rascunhos podem ser iniciados em consultas IN_PROGRESS ou COMPLETED, por ação explícita; abrir a página não cria um registo.

É possível guardar notas, acrescentar procedimentos do catálogo ativo ou registar um procedimento manual, identificando dente/região. Nome e descrição históricos são preservados em snapshots.

A finalização exige notas não vazias e pelo menos um procedimento, com confirmação visual. Depois dela, o conteúdo e os procedimentos não aceitam edição comum. Correções são feitas por aditamentos append-only. Finalizar o prontuário não conclui automaticamente a consulta.

As escritas usam transações, bloqueios de linha e verificação de versão para impedir alterações incompatíveis com uma finalização concorrente. O histórico do dentista fica limitado às consultas desse profissional; o paciente vê apenas os seus registos finalizados.

### Simulação de orçamentos

Na área do dentista, abrir **Simular orçamento**. Os pacientes devem estar ativos e ligados às consultas não canceladas desse profissional. Os procedimentos e os preços atuais vêm do catálogo MySQL. Não existem Budget ou BudgetItem persistidos.

Antes de utilizar um procedimento no cálculo, entre como ADMIN, abra **Gerir procedimentos** e configure o preço real no catálogo. Preço vazio significa não configurado e impede a simulação desse item; zero explícito é permitido. As alterações são gravadas no banco e usadas no próximo cálculo, sem reiniciar a API. A configuração antiga de preços por ambiente deixou de ser necessária; nenhum `.env` privado foi editado automaticamente.

O cadastro de preço exige até duas casas decimais, sem arredondamento silencioso de precisão extra. O backend usa Prisma.Decimal e HALF_UP nos cálculos, com ajuste dos centavos na última parcela. A comparação inclui 1, 3, 6 e 12 parcelas, sem juros. O resumo pode ser impresso via navegador com aviso de estimativa, não recibo ou obrigação financeira.

A simulação permanece apenas na página, sem gravação/recuperação de rascunho ou tabelas de orçamento. A migration do Bloco 6.1 altera somente o catálogo existente. Consulte [Catálogo, preços e simulação](backend/BUDGETS.md) para permissões, migration e regras de arredondamento.

## 6. Organização da API

Os caminhos seguintes são relativos à API. No frontend local, recebem o prefixo `/api` através do proxy.

| Grupo | Endpoints principais |
| --- | --- |
| Sessão | POST /auth/login, GET /auth/me, POST /auth/logout. |
| Cadastro | POST /auth/register. |
| Contas | GET e POST /admin/users. |
| Agenda | GET e POST /appointments; GET e PATCH /appointments/:id; PATCH /appointments/:id/status. |
| Opções da agenda | GET /appointments/config e GET /appointments/options. |
| Prontuário | GET, POST e PATCH /clinical/appointments/:id. |
| Procedimentos/finalização/aditamentos | POST /clinical/appointments/:id/procedures, /finalize e /addenda. |
| Histórico | GET /clinical/appointments/:id/history e GET /clinical/history. |
| Catálogo | GET /clinical/catalog. |
| Catálogo administrativo | GET /procedures; GET e POST /admin/procedures; PATCH /admin/procedures/:id. |
| Simulação de orçamentos | GET /budget-simulations/patients, GET /budget-simulations/procedures e POST /budget-simulations/simulate. |

Escritas exigem Origin igual a FRONTEND_ORIGIN e o cabeçalho `X-OdontoTech-CSRF: 1`, além da sessão quando aplicável. O cliente HTTP do frontend já configura credenciais e o cabeçalho CSRF. As regras completas e os campos aceites estão nas documentações específicas ao final deste ficheiro.

## 7. Testes e última validação

```sh
npm test
npm run build
```

Comandos adicionais:

- `npm run test --workspace backend`: testes backend e integrações configuradas.
- `npm run test --workspace frontend`: testes React em jsdom.
- `npm run prisma:validate --workspace backend`: validação do schema.
- `git diff --check`: verificação do diff.

Na última execução completa do Bloco 6.1, em 23/10/2026:

| Verificação | Resultado |
| --- | --- |
| Backend | 80 testes aprovados, nenhum omitido. |
| Frontend | 92 testes aprovados. |
| Regressões | Autenticação, cadastro, contas, agenda e permissões aprovados. |
| MySQL isolado | Quatro testes de integração aprovados: agenda, prontuário, catálogo/simulação e preservação de dados pelo SQL incremental em tabela temporária. |
| TypeScript e builds | Aprovados nos dois projetos. |
| Revisão visual desktop | Cadastro, edição de preço, confirmação/desativação, reativação e simulação pelo dentista com preço atualizado verificados com API e MySQL de testes. O diálogo nativo de impressão não pôde ser inspecionado no bloco anterior. |
| Lint | Não há configuração no projeto. |

Os testes com mocks verificam regras e estados da interface; não comprovam locks do banco. Os testes MySQL reais verificaram concorrência de agendamentos, unicidade do prontuário, rollback, snapshots, disputa de edição/procedimentos com finalização e simulação decimal com referências reais sem alterar consultas. A impressão usa window.print, coberta por teste automatizado; impressão física e saída PDF não foram validadas. A revisão visual não substitui auditoria completa de acessibilidade nem validação mobile em dispositivos reais.

Esses resultados correspondem à execução realizada após a implementação funcional do Bloco 6.1. Prisma validou o schema; o SQL foi gerado/inspecionado e aplicado primeiro à base isolada e depois à base local de desenvolvimento, com comparação dos registros antes/depois. Não houve reset, preenchimento de preços ou alteração de credenciais. A documentação foi atualizada após essa execução.

### Base de testes isolada

Crie previamente uma base local separada, como `odontotech_test`, e configure a sua DATABASE_URL em `backend/.env.test`. Para preparar somente essa base:

```sh
npm run db:test:setup
```

Também existem `npm run db:test:migrate` e `npm run db:test` para aplicar migrations e verificar conexão separadamente. Esses scripts carregam `.env.test`, não `.env`.

As integrações aceitam TEST_DATABASE_URL explícita ou a DATABASE_URL de `.env.test`. Por segurança, exigem MySQL local e nome `odontotech_test` ou `odontotech_test_<sufixo>`. A validação dos scripts de preparação é mais ampla; utilize os nomes acima para manter compatibilidade com as integrações.

Sem configuração isolada, as integrações são omitidas com mensagem explícita. Nunca aponte testes para `odontotech` de desenvolvimento. As fixtures têm identificadores exclusivos e apenas os seus próprios registos são removidos no final. Os testes não executam reset ou db push.

## 8. Segurança e limites atuais

- Senhas são armazenadas com Argon2id; hashes e tokens não são devolvidos nas respostas públicas.
- Sessão usa cookie HttpOnly e SameSite=Lax; em produção, Secure e prefixo `__Host-`.
- Não há refresh token ou lista de revogação. Logout remove o cookie, mas uma cópia do JWT continua válida até expirar.
- Login/cadastro usam contadores em memória por processo; múltiplas réplicas exigem adaptação antes da publicação.
- Conteúdo clínico não é persistido em localStorage/sessionStorage, URLs ou telemetria da aplicação.
- A imutabilidade clínica protege as rotas da aplicação; um administrador com acesso SQL direto continua tecnicamente capaz de alterar dados.
- A API exige origem precisa. A configuração de desenvolvimento do Vite não fornece um proxy de produção.
- Publicação requer configuração própria de HTTPS, origem, proxy e operação segura do banco. Não há pipeline de deploy, estratégia de backups ou homologação de produção documentados neste repositório.

## 9. Fora do escopo e próximos passos

Ainda não foram implementados: financeiro, orçamentos persistidos/formais, pagamentos, relatórios globais, odontograma gráfico, recuperação de senha, exportação de prontuários, assinatura digital ou partilha pública. A simulação transitória de orçamentos não gera pagamentos ou dívidas. O catálogo e os preços já possuem gestão administrativa no Bloco 6.1.

O botão de recuperação de senha da interface não corresponde a um fluxo de recuperação implementado. A gestão de catálogo não permite exclusão física nem constitui um módulo financeiro.

Possíveis próximos passos, a definir conforme a simplicidade desejada: homologação com utilizadores, validação mobile/acessibilidade, recuperação de acesso e preparação de operação/backup antes de qualquer utilização real. Financeiro só deve ser iniciado se voltar a fazer parte do escopo solicitado.

## 10. Documentação complementar

- [Autenticação e contas](backend/AUTH.md).
- [Agenda e concorrência](backend/AGENDA.md).
- [Prontuário, permissões e imutabilidade](backend/CLINICAL.md).
- [Simulação de orçamentos e configuração de preços](backend/BUDGETS.md).
- [Banco, regras e base de testes](backend/prisma/README.md).
- [Exemplo de ambiente backend](backend/.env.example).
- [Exemplo de ambiente frontend](frontend/.env.example).

Este README consolida o estado atual. Alguns documentos anteriores conservam descrições do momento em que o respetivo bloco foi implementado, como referências a painéis ainda provisórios ou a regras que já foram concretizadas nos blocos seguintes.
