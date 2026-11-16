# Tasks

Rode só os testes relacionados (`npx jest --runTestsByPath …` ou `--findRelatedTests`). Integração MySQL só no arquivo afetado, com `RUN_DB_INTEGRATION_TESTS=true`.

## 1. Interruptor

- [x] 1.1 `src/config/env.js`: `COURIER_REQUIRE_AUTHORIZED_NFE` booleana, desligada por padrão (não segue `NODE_ENV`); `src/index.js` passa `requireAuthorizedNfe` e `blingNfeRepository` ao `CourierDeliveryService`.

  Verificar: `tests/env.parse.test.js` (`NODE_ENV=production` sem a variável desliga, como no QA; `true` explícito liga; `false` explícito desliga).

## 2. Leitura das notas

- [x] 2.1 `BlingNfeRepository.listByStripeInvoices(pairs)`: uma consulta com `(stripe_account, stripe_invoice_id) IN (…)`, lista vazia sem consulta.

  Verificar: teste do repositório (SQL, parâmetros na ordem dos pares, nenhuma consulta para `[]`).

## 3. Trava no despacho

- [x] 3.1 `CourierDeliveryService.dispatch`: com a trava ligada, depois da checagem de endereço e antes da de prontidão, lê a nota da fatura na conta da assinatura e recusa com `422 courier_nfe_not_authorized` (`nfe_status`, `nfe_id`) quando não é `authorized`. Sem repositório de NF-e e com a trava ligada, responde 503.

  Verificar: `tests/courier-delivery.service.test.js` (autorizada passa; `submitted`, `rejected`, `canceled` e sem nota recusam; `confirm_not_ready: true` não libera; trava desligada ignora a nota; nada é inserido nem auditado na recusa) e `tests/admin-courier-deliveries.routes.test.js` (o código e os detalhes chegam à resposta).

## 4. NF-e na fila

- [x] 4.1 `listQueue`: `nfe` (`{ id, status, number }` ou `null`) em cada item de "A despachar" e "Falhas", lido de uma vez pela conta e fatura de cada linha; `nfe_required` na resposta (também na resposta vazia de quem não vê o Brasil).

  Verificar: `tests/courier-delivery.service.test.js` (linha com e sem nota; nota de outra conta não conta; uma chamada ao repositório por leitura; "Em rota" sem `nfe`; `nfe_required` com a trava ligada e desligada).

## 5. Hoje

- [x] 5.1 `countPaidCourierCyclesToDispatch({ …, nfeTableName })`: com `nfeTableName`, soma o `NOT EXISTS` de nota `authorized` na mesma conta e fatura, com `COLLATE` dos dois lados.

  Verificar:
  - `tests/subscription-ledger.courier.test.js` (SQL com e sem `nfeTableName`);
  - `RUN_DB_INTEGRATION_TESTS=true npx jest --runTestsByPath tests/integration/subscription-ledger-queue.integration.test.js` (autorizada não conta, rejeitada e sem nota contam, nota de outra conta não serve).
- [x] 5.2 `countQueue` devolve `awaitingNfe` (null com a trava desligada, 0 fora do escopo do Brasil) e `AdminTodayService` expõe `fulfillment.courierAwaitingNfe`.

  Verificar: `tests/courier-delivery.service.test.js` e `tests/admin-today.service.test.js` (ligada conta; desligada é null; operador dos EUA recebe 0).

## 6. Fechamento

- [x] 6.1 `npx jest --changedSince=HEAD`, `npm run routes:manifest` sem diferença em `docs/api-routes.json` (nenhuma rota nova), a variável documentada onde as outras do Bling estão (`.env.example` e `.env.qa.example`, desligada no QA) e como obrigatória em produção na seção "Environment" de `docs/production-go-live.md`.
