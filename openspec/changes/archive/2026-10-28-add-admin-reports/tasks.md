# Tasks

## 0. Pré-requisito

- [x] 0.1 Validar no servidor a versão do MySQL que roda no Docker, pelo MCP da Hostinger, só para leitura. Feito em 2026-10-28 com `vps_virtual-machines_list`, `vps_docker_list` e `vps_docker_logs` (todas `readOnly`; nenhuma escrita, restart ou deploy). Resultado: container `eden-bowls-mysql-qa`, imagem `mysql:8.4`, `MySQL Community Server 8.4.11`. Está anotado em `design.md`, e as decisões 9 (`JSON_TABLE`) e 12 (`MAX_EXECUTION_TIME`) ficaram sem alternativa para MariaDB.

## 1. Permissões e mercado único

- [x] 1.1 Adicionar `reports.read` a `readonly` e `operator`, e `reports.export` a `operator`, em `src/core/admin-roles.js` (o admin herda). Verificar com `npx jest --runTestsByPath tests/admin-roles.test.js`, com casos novos: veterinário sem nenhuma das duas, somente leitura só com `reports.read`.
- [x] 1.2 Criar `requireSingleReportMarket` em `src/core/admin-market-scope.js` (`400 report_market_required` quando há dois mercados). Verificar com casos novos em `tests/admin-market-scope.test.js`: operador BR sem `market` → BR; admin sem `market` → 400; admin com `market=US` → US.

## 2. Datas de ativação e de término no ledger

- [x] 2.1 Criar a migração `1700000000055-add-subscription-lifecycle-dates.js`, com:
  - as colunas `activated_at`, `activated_at_approximate`, `canceled_at` e `canceled_at_approximate`;
  - o backfill da decisão 6 (ativação por status atual ou por fatura paga/cobrada; término por `updated_at` só para quem ativou);
  - os índices `customer_invoices(stripe_account, issued_at)`, `stripe_subscriptions(stripe_account, activated_at)` e `stripe_subscriptions(stripe_account, canceled_at)`, só os que ainda não existem.

  Verificar com `tests/subscription-lifecycle-dates.migration.test.js` (up/down; linha `canceled` sem pagamento fica vazia; linha `canceled` com fatura recebe as duas datas aproximadas).
- [x] 2.2 No upsert do ledger, gravar `activated_at` na primeira vez em `active`/`trialing`/`past_due` e nunca mais mudar. Gravar `canceled_at` só com status `canceled`, de `ended_at || canceled_at`. Verificar com casos novos em `tests/subscription-ledger.repository.test.js` e nos testes do webhook:
  - pedido com `cancel_at_period_end` não grava data;
  - desistência do cancelamento mantém o campo vazio;
  - `customer.subscription.deleted` grava `ended_at`;
  - update posterior não muda a data;
  - `incomplete_expired` nunca ativa;
  - `past_due` → `active` mantém a primeira ativação.
- [x] 2.3 Trocar `canceled30d` de `SubscriptionLedgerRepository.metrics` para `canceled_at`, só entre as linhas ativadas. Verificar com `npx jest --findRelatedTests src/infrastructure/repositories/subscription-ledger.repository.js`.

## 3. Período e buckets

- [x] 3.1 Criar `src/core/report-period.js`, com:
  - validação de `from`/`to` (`400 report_period_invalid`);
  - padrão de 30 dias terminando ontem;
  - limitação a hoje;
  - período anterior, com corte no mesmo horário quando `to` é hoje (`partialToday`);
  - limites UTC por fuso;
  - granularidade padrão.

  Verificar com `tests/report-period.test.js`: o exemplo de 2026-10-28, hoje às 15:00, 367 dias, a fatura de 02:00 UTC nos EUA e as viradas de horário de verão de março e novembro.
- [x] 3.2 Criar o agregador de hora UTC para bucket local, com a lista completa de buckets, semana começando na segunda e `partial` nas bordas e em hoje. Verificar no mesmo teste: buckets vazios com zero, março e outubro parciais no exemplo mensal, e a soma por semana e por mês.

## 4. Repositório e service de relatórios

- [x] 4.1 Criar `src/infrastructure/repositories/admin-reports.repository.js` com uma consulta agregada por fonte, todas com o hint `MAX_EXECUTION_TIME(10000)`:
  - faturas pagas (filtro por `stripe_account` e `currency`, contagem de `excludedInvoices`, `billing_reason`, por hora);
  - assinaturas (retrato atual, novas e canceladas entre as linhas ativadas, `activeAtStart`, churn da coorte, aproximadas);
  - funil com a etapa 3 por `activated_at`;
  - mix com `JSON_TABLE`;
  - ciclos pagos por status, atrasados e `awaitingPayment`, e envios UPS;
  - movimentos de estoque.

  Verificar com `tests/admin-reports.repository.test.js`, com `dataSource` fake:
  - filtro de mercado e de moeda sempre presentes;
  - nenhum `SELECT` de e-mail ou nome;
  - hint presente em toda consulta;
  - erro 3024 vira `report_timeout`.
- [x] 4.2 Criar `src/core/report-mrr.js` (soma do `subtotal` mensal em minor units; `trialing` e linhas sem preço separados). Verificar com `tests/report-mrr.test.js`: active e past_due somados, trialing separado, linha sem preço, arredondamento de centavos.
- [x] 4.3 Criar `src/services/admin-reports.service.js`, que monta os sete relatórios com `value`/`previous`, conversões e churn (`null` quando o denominador é zero), `shipments: null` para BR, "hoje" no fuso do mercado para os atrasados, nomes de receita do mercado e `logger.warn` quando `excludedInvoices > 0`. Verificar com `tests/admin-reports.service.test.js`, que cobre cada cenário de cálculo de `specs/admin-reports/spec.md` (incluindo 100 ativas no início, 4 + 1 canceladas e churn 0,04).
- [x] 4.4 Criar `src/core/report-csv.js` (`excel`: BOM, `;` e vírgula; `csv`: `,` e ponto; aspas; prefixo `'` contra fórmula só em texto; nome do arquivo). Verificar com `tests/report-csv.test.js`:
  - `12345,67` e `12345.67`;
  - BOM só no `excel`;
  - `=HYPERLINK` escapado e `-3` intacto;
  - o CSV de receita bate com o JSON e não tem dados pessoais.

## 5. Rotas

- [x] 5.1 Registrar `GET /api/v1/admin/reports/{summary,revenue,subscriptions,acquisition,mix,operations,stock}` com `requirePermission('reports.read', { market: 'query' })`. Registrar `export.csv` com `reports.export`, a checagem de `reports.read`, `formato` e `400 report_unknown`. Ligar o service em `src/app.js`. Verificar com `tests/admin-reports.routes.test.js`:
  - 403 para veterinário;
  - 403 de export para somente leitura;
  - `market_forbidden`, `report_market_required` e `report_period_invalid`;
  - só o bloco BR no summary de um operador BR;
  - 503 `report_timeout`;
  - POST → 404.
- [x] 5.2 Rodar `npm run routes:manifest` e commitar `docs/api-routes.json`. Verificar com `npx jest --runTestsByPath tests/api-routes-manifest.test.js tests/admin-market-scope-registry.test.js`.

## 5b. Ajustes da revisão da demonstração

- [x] 5b.1 Mercado do checkout na origem: upsert do CEP com `COALESCE(NULLIF(market, ''), VALUES(market))` e migração `1700000000056-backfill-onboarding-user-state-market.js` a partir de `hsr_market_country`. Verificar com `tests/onboarding-zipcode.repository.test.js`, `tests/onboarding-user-state-market.migration.test.js` e `tests/integration/onboarding-user-state-market.integration.test.js`.
- [x] 5b.2 `unassignedCheckouts` no relatório de aquisição, só para admin, sem fallback na contagem das etapas. Verificar em `tests/admin-reports.service.test.js` e na integração.
- [x] 5b.3 Mix e estoque: receita sem nome pela chave com `nameMissing` e marca no CSV; tamanho de pack por grama, com `oz (g)` nos EUA. Verificar em `tests/admin-reports.service.test.js` e `tests/report-csv.test.js`.
- [x] 5b.4 Operação: `awaitingPayment` fora das contagens por status e do `late` (requisito e cenário atualizados na spec).

## 6. Integração

- [x] 6.1 Rodar `npx jest --changedSince=main` e corrigir as falhas.
- [x] 6.2 Com `RUN_DB_INTEGRATION_TESTS=true`, rodar a migração 055 e os testes de integração do ledger contra o MySQL local. Depois, chamar `GET /api/v1/admin/reports/summary` com uma sessão admin (devem vir os dois blocos) e abrir um `export.csv` no Excel em pt-BR (colunas e acentos corretos). Anotar o resultado no PR. Feito em 2026-10-28: migrações 055 e 056 e 32 suítes de integração (97 testes) passando no MySQL local; `summary` ao vivo com os dois blocos; CSV conferido pelo usuário no Excel pt-BR (colunas e acentos corretos).
- [x] 6.3 Avisar o change irmão do painel (`eden-bowls-admin/openspec/changes/add-admin-reports`) que o manifesto está pronto para `npm run contract:sync`.
