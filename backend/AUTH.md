# Autenticação

Inicie os dois projetos na raiz com `npm run dev`. O frontend usa `http://localhost:5173` e o proxy `/api` encaminha para a API em `http://localhost:3333`. Use o mesmo hostname no navegador e em `FRONTEND_ORIGIN`; a porta do Vite é fixa para evitar incompatibilidade de origem. Caso altere a porta da API, ajuste o proxy do Vite.

## Ambiente

O backend carrega `backend/.env`, preservando `DATABASE_URL` ou as variáveis `DB_*` existentes. `JWT_SECRET` é obrigatório: pelo menos 32 bytes criptograficamente aleatórios em hexadecimal. Não use a senha do banco. O backend falha na inicialização se o segredo estiver ausente ou inválido. Para gerar outro segredo localmente:

```sh
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

Guarde o resultado apenas no ambiente privado do backend. Trocar o segredo invalida todos os tokens assinados anteriormente. As opções e valores não secretos estão em `.env.example`. Não use esse exemplo como ficheiro de produção.

## Rotas

- `POST /auth/login`: JSON `{ "email": "...", "password": "..." }`. Normaliza o e-mail; valida a senha sem a aparar; verifica o hash Argon2id existente e o estado `ACTIVE`. O perfil eventualmente enviado pelo cliente é ignorado. Resposta contém apenas `{ user: { id, name, role } }`.
- `GET /auth/me`: valida JWT e consulta novamente o utilizador. Desativação, eliminação e alterações de perfil têm efeito nas chamadas protegidas seguintes.
- `POST /auth/logout`: apaga o cookie, mesmo quando a sessão está expirada. Não há lista de revogação: uma cópia do token continua válida até expirar. Não há refresh token.

JWT assinado com HS256, `sub`, `iat`, `exp`, emissor `odontotech-api` e audiência `odontotech-web`. Prazo padrão de uma hora, configurável por `JWT_EXPIRES_IN_SECONDS`. O token só é enviado no cookie HttpOnly, SameSite=Lax, Path=/, sem Domain; em produção usa Secure e prefixo `__Host-`. O JSON não contém o token. Nenhuma credencial ou token é guardado em localStorage/sessionStorage.

Todas as operações que alteram estado exigem `Origin` exatamente igual a `FRONTEND_ORIGIN` e `X-OdontoTech-CSRF: 1`. O cabeçalho customizado exige preflight em origens diferentes; CORS só permite a origem configurada com credenciais. Esta política também se aplica ao login para evitar login CSRF. Clientes de teste ou integração devem enviar os dois cabeçalhos. Respostas de autenticação usam Cache-Control: no-store.

O middleware `authenticate` confirma a identidade atual no banco. `authorize(...roles)` vem depois dele nas rotas privadas. Proteção de rotas React não substitui esses middlewares. O cadastro de pacientes e a gestão administrativa foram adicionados no Bloco 3; os restantes painéis continuam provisórios.

## Cadastro de pacientes e gestão de contas

- `POST /auth/register`: aceita estritamente `name`, `email`, `password`, `confirmPassword`, `phone` e `birthDate`. Telefone e nascimento são opcionais; quando enviados são validados. Nascimento usa `YYYY-MM-DD`, data real e não futura. O backend fixa `PATIENT` e `ACTIVE` e cria sempre `PatientProfile`. Sucesso: 201, `{ user: { id, name, role } }`, sem cookie ou login automático. O frontend encaminha ao login com confirmação de sucesso.
- `POST /admin/users`: exige sessão ativa e papel ADMIN atual no banco. Campos comuns: `name`, `email`, `password`, `confirmPassword`, `role`. Só aceita `RECEPTIONIST` ou `DENTIST`. Dentistas exigem `croNumber` e `croState`; `specialty` é opcional. O CRO passa por validação estrutural (estado de duas letras, número até 30 caracteres), sem afirmar que a inscrição profissional foi consultada. Rececionistas não recebem perfil adicional. ADMIN continua exclusivo do seed.
- `GET /admin/users?page=1&pageSize=10`: exclusivo de ADMIN. Páginas de 1 a 50 contas com `id`, `name`, `email`, `role`, `status`, `createdAt`, mais `total`, `page` e `pageSize`. Não inclui perfis clínicos nem hashes. A ordenação é por criação e identificador.

Novas senhas têm 12 a 128 caracteres, incluindo maiúscula, minúscula, número e símbolo. O e-mail é aparado e convertido para minúsculas; a senha é preservada sem aparar. A confirmação é obrigatória na API e na interface. Os campos desconhecidos são rejeitados com 400, incluindo tentativas de enviar estado, IDs, hash ou perfil privilegiado ao cadastro público. Conflitos de e-mail ou CRO retornam 409 sem detalhes Prisma/SQL. Falhas inesperadas retornam 500 genérico.

As criações usam uma única operação Prisma com escrita aninhada transacional. Falhar ao criar o perfil desfaz a criação da conta; a restrição UNIQUE continua a garantir unicidade perante pedidos concorrentes. O código não remove contas para resolver conflitos. O schema e a migration inicial não foram alterados.

Aceda a `/admin`, depois a “Gerir utilizadores” para abrir `/admin/utilizadores`. A interface só permite criar rececionistas e dentistas; não há eliminação, mudança de papel ou suspensão de contas neste bloco. Senhas iniciais ficam apenas na memória do formulário e são limpas após sucesso.

## Limitação de tentativas e produção

`express-rate-limit` limita tentativas por IP, incluindo entradas inválidas, com janela e limite configuráveis. A configuração atual usa o armazenamento em memória da biblioteca e destina-se a um único processo. Reiniciar o processo limpa os contadores; várias réplicas exigem um armazenamento partilhado antes da publicação. Não é uma proteção distribuída. O servidor não confia automaticamente em `X-Forwarded-For`; numa implantação atrás de proxy deve-se configurar a lista precisa de proxies confiáveis.

O cadastro público usa a mesma infraestrutura com contador separado do login: `REGISTER_RATE_LIMIT_MAX=5` e `REGISTER_RATE_LIMIT_WINDOW_MS=900000` por padrão. Login e cadastro preservam CORS, CSRF e respostas sem cache.

Em produção configure `NODE_ENV=production`, `FRONTEND_ORIGIN=https://...` e HTTPS. Sirva frontend e API no mesmo site, preferencialmente através do caminho `/api`; configure o proxy de produção para esse caminho, pois o proxy do Vite só existe em desenvolvimento. SameSite=Lax não serve uma implantação entre sites distintos sem adaptação da arquitetura e da proteção CSRF.

## Verificação

`npm test` na raiz executa os testes HTTP do backend com repositório em memória e os testes React em jsdom. Não há alterações na base de desenvolvimento. `npm run build` verifica TypeScript e compila os dois projetos. O repositório não tinha lint nem testes configurados antes deste bloco.
