# Consultas e agenda diária

## API e permissões

Todas as rotas `/appointments` exigem a autenticação existente e usam respostas sem cache. Escritas preservam Origin exata e X-OdontoTech-CSRF. ADMIN e RECEPTIONIST criam, editam e gerem os estados operacionais. DENTIST lê apenas consultas do seu perfil e executa WAITING → IN_PROGRESS → COMPLETED. PATIENT só lê as consultas do seu perfil.

- `GET /appointments/config`: fuso e limites de apresentação da grelha.
- `GET /appointments/options?kind=patients|dentists&search=&page=1&pageSize=20`: apenas operadores, perfis ativos com papel correto, IDs de perfil e nomes; paginação com hasMore e limite de 50 resultados por página.
- `GET /appointments?date=YYYY-MM-DD&dentistId=...&status=...`: date obrigatório; filtros de dentista e estado opcionais. Filtro de dentista só para operadores. Não existe patientId livre na query. O âmbito de paciente/dentista é imposto na consulta SQL com a identidade autenticada.
- `GET /appointments/:id`: ausente e consulta de terceiros recebem 404.
- `POST /appointments`: patientId e dentistId são IDs de perfil, startAt/endAt são ISO 8601 com segundos e Z ou offset explícito; reason é opcional até 1000 caracteres. Retorna 201. Estado SCHEDULED, autor e timestamps são definidos no backend.
- `PATCH /appointments/:id`: campos operacionais da criação, parcialmente enviados. Só SCHEDULED e CONFIRMED podem ser editadas.
- `PATCH /appointments/:id/status`: status obrigatório e cancellationReason opcional apenas no cancelamento. Não há eliminação ou reabertura de estados terminais.

Transições: SCHEDULED → CONFIRMED/CANCELLED; CONFIRMED → WAITING/CANCELLED/NO_SHOW; WAITING → IN_PROGRESS/CANCELLED; IN_PROGRESS → COMPLETED. Os restantes estados são terminais. Cancelar preserva ID, horários e histórico; a interface solicita confirmação.

## Bloqueios e integridade

O schema não usa @@map: os nomes físicos são `DentistProfile` e `Appointment`. Não foi necessária migration. O repositório usa transações Prisma em READ COMMITTED, maxWait de 5 segundos e timeout de 10 segundos. Dentro delas, bloqueia as linhas dos dentistas com SELECT ... FOR UPDATE, uma a uma em ordem crescente de ID, usando parâmetros seguros. Em edições e mudanças de estado, bloqueia e relê a consulta depois dos dentistas.

Todas as escritas usam esse mecanismo. Ao trocar de profissional, bloqueia dentistas antigo e novo na mesma ordem. Se o dentista mudou desde a leitura inicial, a escrita é recusada com 409 e o cliente deve atualizar. Validação de perfis, pesquisa de conflitos e gravação ocorrem na mesma transação, depois dos bloqueios. READ COMMITTED garante que a pesquisa vê dados confirmados depois de aguardar o bloqueio.

Conflito: mesmo dentista, estado diferente de CANCELLED, startAt existente < endAt novo e endAt existente > startAt novo. Consultas adjacentes são permitidas; concluídas e faltas continuam a bloquear. Um índice comum não garante essa regra. Futuras rotas, importações e scripts de escrita devem respeitar o protocolo: uma escrita SQL direta fora dele pode violar a integridade.

Deadlocks/conflitos P2034, transações expiradas P2028 e timeouts MySQL 1205/1213 são convertidos para 409. Violações de referência e registo ausente recebem erros controlados. Erros inesperados usam o tratamento genérico sem expor SQL.

Referências: [Prisma 6 — transações](https://www.prisma.io/docs/orm/v6/prisma-client/queries/transactions) e [MySQL — locking reads](https://dev.mysql.com/doc/refman/8.4/en/innodb-locking-reads.html).

## Datas e apresentação

Timestamps são armazenados em UTC: DateTime no MySQL não contém fuso, pelo que UTC é a convenção da aplicação. Luxon faz conversões no backend e frontend. O dia da agenda é [início local do dia, início local do dia seguinte), incluindo dias de 23 ou 25 horas. Não é um intervalo fixo de 24 horas nem um offset fixo de -03:00. Consultas que atravessam a meia-noite são incluídas quando intersetam o dia.

Configuração central no backend: CLINIC_TIMEZONE=America/Sao_Paulo, AGENDA_START_HOUR=8, AGENDA_END_HOUR=18 e AGENDA_SLOT_MINUTES=60. Estes limites são apenas de apresentação; a API admite horários fora deles. Consultas iniciadas fora da grelha aparecem numa secção própria. Qualquer ocupação parcial impede que um slot apareça como Livre. Sem profissional definido, ou na visão do paciente, aparece “Sem consultas neste intervalo”, sem afirmar disponibilidade da clínica. Livre nunca é persistido.

O formulário interpreta data e hora no fuso da clínica e envia UTC. Horários locais inexistentes ou ambíguos por mudança de horário de verão são recusados na interface; clientes da API podem enviar o offset explícito pretendido. A data de término própria permite atravessar dias. A grelha carrega todos os estados para não confundir filtros com disponibilidade.

“Abrir agenda” está disponível na área de cada perfil. Seletores usam exclusivamente a API, com pesquisa e páginas adicionais. Falhas não são transformadas em agenda vazia. Diálogos nativos oferecem navegação por teclado e foco; submissões pendentes são bloqueadas. Sucessos e conflitos recarregam a lista sem recarregar a aplicação.

## Testes

`npm test` executa regras HTTP/serviço com mocks, testes React e regressões. Os mocks verificam regras, filtros e utilização do protocolo transacional, mas não comprovam bloqueios InnoDB reais.

`tests/appointments.mysql.test.ts` usa TEST_DATABASE_URL explicitamente definida ou a DATABASE_URL de `backend/.env.test`. Nunca usa a URL de desenvolvimento como fallback. Só aceita MySQL local com nome `odontotech_test` ou `odontotech_test_<sufixo>`. A base deve estar previamente migrada (os scripts db:test:setup existentes usam .env.test). Sem configuração isolada, o teste é omitido explicitamente; com configuração incorreta, falha.

O teste confirma engine InnoDB, cria fixtures exclusivas, disputa o mesmo intervalo em criações e edições concorrentes e verifica que só uma operação incompatível confirma. Depois remove apenas os seus próprios registos, preservando quaisquer outros dados da base de teste. Não executa reset, db push ou alterações na base odontotech. Execute isoladamente: `node --import tsx --test backend/tests/appointments.mysql.test.ts` a partir da raiz.
