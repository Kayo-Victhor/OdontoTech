# Catálogo de procedimentos e simulação de orçamentos — Blocos 6 e 6.1

## Estado atual

Os procedimentos e os seus preços são administrados no MySQL, pelo modelo Procedure existente. O administrador gere o catálogo pela interface; o dentista consulta os itens ativos e simula tratamentos para pacientes autorizados.

As simulações continuam transitórias: não existe Budget/BudgetItem persistido, obrigação financeira, aceite formal, dívida, vencimento ou pagamento. Não foram criados snapshots persistidos de orçamento, nem reutilizado o prontuário como armazenamento financeiro.

## Modelo e migration incremental

Procedure preserva id, name, description, isActive, createdAt, updatedAt e a relação com ClinicalProcedure. O Bloco 6.1 acrescenta:

- defaultPrice: Decimal opcional, DECIMAL(10,2), para valores de 0.00 a 99999999.99.
- estimatedDurationMinutes: o campo existente passa a aceitar null.

A migration 20261023000200_procedure_default_price foi gerada com prisma migrate diff e inspecionada. O SQL é:

```sql
ALTER TABLE `Procedure` ADD COLUMN `defaultPrice` DECIMAL(10, 2) NULL,
    MODIFY `estimatedDurationMinutes` INTEGER NULL;
```

Não remove tabelas/colunas, não modifica IDs, não atribui preços e não recria a migration inicial. Procedimentos anteriores recebem preço null, não zero. A duração anterior é preservada.

A migration foi aplicada primeiro à base local isolada odontotech_test e depois à base de desenvolvimento localhost/odontotech. Uma comparação em memória dos registros antes/depois na base de desenvolvimento confirmou preservação de contas, credenciais, perfis, consultas, registros clínicos e procedimentos; valores privados não foram impressos. Nenhuma migration foi aplicada em produção.

Em outra instalação, confira o destino e aplique somente as migrations versionadas antes de iniciar esta versão. A partir da raiz:

```sh
npm run prisma:generate --workspace backend
npm exec --workspace backend -- prisma migrate deploy
```

Na base de testes já configurada, use npm run db:test:migrate. Não use reset, recriação da base ou db push.

## Configuração pelo painel administrativo

1. Entre com uma conta ADMIN e abra **Gerir procedimentos**, em /admin/procedimentos.
2. Cadastre nome, descrição opcional, preço padrão opcional e duração opcional.
3. Para definir preço de um item anterior, use **Editar** e guarde o valor real definido pela clínica.
4. Deixe o preço vazio para marcar como não configurado. Digite zero somente se esse for realmente o preço definido.
5. Ative/desative a disponibilidade pela lista ou pelo formulário. Desativação exige confirmação.

Preço é uma string decimal no contrato HTTP, não um número JSON de ponto flutuante. A interface aceita vírgula decimal e envia ponto; não aceita separador de milhar. A API aceita até duas casas decimais e recusa precisão extra, em vez de arredondar silenciosamente o cadastro.

Nome é aparado e espaços consecutivos são normalizados, com 2–191 caracteres. Descrição tem até 2000 caracteres; vazia torna-se null. Duração é null ou inteiro de 1–1440 minutos. Disponibilidade é booleana. Campos internos, IDs e timestamps não podem ser definidos pelo cliente.

Os nomes não são UNIQUE no schema original: não foi criada uma restrição artificial que pudesse inviabilizar dados existentes. Os IDs distinguem os itens; erros de unicidade que a base devolver são tratados com 409, sem expor SQL.

Não há exclusão física na API. Alterar nome, descrição, preço ou disponibilidade não modifica os snapshots dos procedimentos clínicos já registrados.

## Permissões e API do catálogo

Todas as rotas exigem autenticação existente e retornam Cache-Control: no-store. Escritas respeitam Origin exata e X-OdontoTech-CSRF: 1.

| Rota | Permissão e conteúdo |
| --- | --- |
| GET /procedures | ADMIN ou DENTIST ativo com DentistProfile válido; somente procedimentos ativos, inclusive os sem preço. |
| GET /admin/procedures | ADMIN; todos os itens, incluindo desativados e sem preço. |
| POST /admin/procedures | ADMIN; cadastro. |
| PATCH /admin/procedures/:id | ADMIN; atualização parcial dos campos permitidos, sem objeto vazio. |

Listas aceitam search (até 80 caracteres), page (a partir de 1) e pageSize (padrão 20, máximo 50), e devolvem items/hasMore, com ordenação estável por nome e ID.

O DTO contém id, name, description, defaultPrice (string com duas casas ou null), estimatedDurationMinutes, isActive, createdAt e updatedAt. Não contém dados clínicos ou credenciais. Criação retorna 201; atualização retorna 200; dados inválidos recebem 400; acesso indevido 403; ID ausente 404; conflitos de unicidade 409. Falhas inesperadas mantêm o erro/log genérico da aplicação.

RECEPTIONIST e PATIENT não acedem ao catálogo nem à sua gestão. DENTIST não pode cadastrar, editar preços ou alterar disponibilidade. Os middlewares e os serviços verificam essas regras; a proteção não depende dos botões da interface.

As leituras anteriores /budget-simulations/procedures e /clinical/catalog foram mantidas pelos contratos específicos de cada módulo. Não representam tabelas de procedimentos adicionais. A listagem da simulação reutiliza o repositório do catálogo; a clínica continua a selecionar apenas id/nome dos ativos.

## Eliminação da configuração antiga

A variável BUDGET_PROCEDURE_PRICES_JSON não é mais lida pelo código. O leitor antigo e a entrada de .env.example foram removidos. Valores dessa variável não são importados nem usados como fallback.

Se ela existir em algum ambiente privado, pode ser removida manualmente pelo responsável. Nenhum arquivo .env local foi alterado ou apagado automaticamente. Preços são configurados pelo painel e gravados no banco; não é necessário reiniciar a API a cada alteração de catálogo.

## Simulação: vínculo e referências

Somente DENTIST ativo, com perfil profissional válido, pode usar a simulação. O paciente deve ser ativo, ter PatientProfile ligado a PATIENT e possuir pelo menos uma consulta não cancelada com esse dentista. O âmbito é imposto no SQL, na pesquisa e no cálculo. Não são consultadas notas clínicas para formar a estimativa.

- GET /budget-simulations/patients: id/name dos pacientes autorizados, com paginação.
- GET /budget-simulations/procedures: catálogo ativo com id/name/description/unitPrice; null significa preço não configurado.
- POST /budget-simulations/simulate: recebe apenas patientId, items e installments, sem gravar orçamento.

Cada item recebe procedureId e quantity. São permitidos 1–50 procedimentos distintos, quantidades inteiras de 1–100 e 1–12 parcelas. Campos extras, como unitPrice, total, dentistId, authorId, status ou interestRate, são rejeitados.

O cálculo consulta novamente o MySQL para todos os itens: procedimento inexistente ou inativo recebe 400, preço null recebe 409 e paciente inexistente ou fora do âmbito recebe 404. Zero explícito é válido. O navegador nunca escolhe o preço ou o total.

Novos cálculos usam o preço atualizado no banco, mesmo que a seleção anterior ainda mostre um preço de referência. O resultado já recebido permanece como estimativa daquele instante, sem se transformar em orçamento persistido.

## Decimal e parcelamento

É utilizado Prisma.Decimal, já disponível no projeto. Nenhuma biblioteca monetária adicional foi instalada.

1. Preço do banco é apresentado com duas casas; não existe Float monetário no schema.
2. Subtotal é preço unitário × quantidade inteira, com duas casas e ROUND_HALF_UP.
3. Total é a soma Decimal dos subtotais.
4. Para N parcelas, regular = total/N truncado para duas casas com ROUND_DOWN.
5. Primeiras N−1 parcelas usam regular; última = total−regular×(N−1).

A comparação inclui 1, 3, 6 e 12 parcelas e a quantidade selecionada, sem duplicações, juros ou taxas. A resposta inclui os valores individuais, regularAmount, lastAmount e adjustment. A soma corresponde exatamente ao total, inclusive para poucos centavos ou zero.

Exemplo puramente aritmético, não preço ou condição real da clínica: 100.01 em 3 parcelas = 33.33 + 33.33 + 33.35.

## Interface e impressão

O dentista abre **Simular orçamento**, em /dentista/orcamentos. Pacientes e catálogo vêm da API real; itens sem preço aparecem identificados e bloqueados, sem serem considerados gratuitos. É possível adicionar, alterar quantidades e remover itens antes do cálculo.

Mudar paciente, itens ou parcelamento invalida o resumo anterior, cancelando/ignorando respostas antigas. Submissões repetidas são bloqueadas. A interface usa o total devolvido pelo backend, não calcula dinheiro com Number e não persiste escolhas/resumos em localStorage ou sessionStorage.

O resumo mostra OdontoTech (nome institucional já disponível), identificação básica do paciente, nome/CRO do profissional, data no fuso da clínica, descrição, quantidades, preços, subtotais, total e parcelamentos. Não foram inventados endereço, CNPJ ou outros dados da clínica.

**Imprimir estimativa** chama window.print. O CSS de impressão oculta formulário, navegação e botão, mantendo resumo e aviso explícito: estimativa, não pagamento, recibo, fatura ou compromisso financeiro. Nenhuma API de impressão, fiscal ou pagamento é chamada.

## Validação e limites

Na execução final do Bloco 6.1: 80 testes backend e 92 frontend aprovados, sem testes backend omitidos. Builds/TypeScript, validação Prisma e git diff --check aprovados. As quatro integrações MySQL foram executadas de verdade, não substituídas por mocks.

Os testes com mocks verificam acesso por perfil, normalização, preços inválidos, edição, disponibilidade, paginação, respostas sem detalhes internos, cálculos decimais, manipulação de preços pelo cliente e estados React. O teste de impressão verifica a chamada de window.print sem criar outro pedido à API.

A integração MySQL verifica cadastro/edição pelo endpoint administrativo, persistência Decimal, distinção null/zero, preço atualizado em novas simulações, bloqueio de inativos e preservação integral do prontuário/snapshots associados. O SQL incremental também é executado contra uma tabela TEMPORARY privada com uma linha no formato anterior, confirmando preservação de valores e preço null.

Integrações usam TEST_DATABASE_URL explícita ou DATABASE_URL de backend/.env.test, exigindo host local e nome odontotech_test ou odontotech_test_<sufixo>. Sem URL, são omitidas explicitamente. Criam/removem apenas fixtures exclusivas; não executam reset ou db push. A aplicação da migration na base isolada é um passo separado, anterior à suíte.

Revisão visual desktop: administrador → catálogo → cadastro → edição de preço → confirmação/desativação → reativação → login dentista → simulação com preço atualizado do banco. A prévia usa API temporária e MySQL de testes, sem dados reais da clínica. A validação visual não substitui auditoria de acessibilidade ou testes mobile em dispositivos reais. A pré-visualização nativa de impressão, impressão física e saída PDF permanecem não validadas.

Atualizações administrativas usam PATCH dos campos enviados, sem controle de versão otimista: edições concorrentes do mesmo campo seguem a última escrita confirmada. Não há exclusão de histórico; alterações diretas com privilégios SQL administrativos ficam fora das garantias das rotas.

## Arquivos principais

- Modelo/migration: prisma/schema.prisma e prisma/migrations/20261023000200_procedure_default_price/migration.sql.
- Catálogo backend: src/validators/procedures.ts, src/repositories/procedures.ts, src/services/procedures.ts e src/routes/procedures.ts.
- Integração: src/app.ts, src/server.ts e repositório/serviço/rotas de budgets.
- Frontend: src/services/procedures.ts, components/ProcedureForm.tsx e pages/AdminProceduresPage.tsx, mais navegação, estilos e mensagens da simulação.
- Testes: procedures.test.ts, procedure-migration.mysql.test.ts, budgets.mysql.test.ts e regressões de simulação/frontend.
- Documentação: README.md da raiz, prisma/README.md e este documento.

**Não foram implementadas APIs de pagamentos, dívidas ou operações financeiras reais.** Continuam fora do escopo Pix/cartões/bancos/gateways, alocação de pagamentos, parcelas devidas, recibos, caixa, estornos, aceite formal e integrações fiscais.
