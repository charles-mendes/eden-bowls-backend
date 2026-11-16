# Tasks

Rodar só os testes relacionados (`npx jest --runTestsByPath …` ou `--findRelatedTests <source>`), nunca a suíte inteira.

## 1. Mercados efetivos em `/admin/me`

- [x] 1.1 Incluir `effectiveMarkets` na identidade devolvida por `GET /api/v1/admin/me`, usando `effectiveMarkets` de `src/core/admin-market-scope.js` e tratando `market_required` como `[]`. Verificar: `tests/admin-me.routes.test.js` com admin, operador BR, operador sem mercado com a flag desligada e ligada (este último continua `200`).

## 2. NF-e

- [x] 2.1 `parseNfeListQuery` aceita até três status separados por vírgula, valida cada um contra `NFE_STATUSES` (`422 invalid_status` se algum for desconhecido) e devolve a lista; `bling-nfe.repository.js` `list` usa `IN` para lista e `=` para um. Verificar: `tests/bling-nfe.routes.test.js` (três status, status desconhecido na lista, um status como hoje) e o teste do repositório, se houver.
- [x] 2.2 `parseNfeCustomerInput` aceita `reason` opcional (3–255 após trim, `422 invalid_nfe_customer` fora disso) e `updateCustomer` grava `reason` no metadata de `nfe.customer.update`. Verificar: `tests/bling-nfe.customer-edit.test.js` e `tests/bling-nfe.routes.test.js`.

## 3. Correção de endereço do perfil

- [x] 3.1 `PATCH /admin/users/:userId/delivery`: separar e validar `reason` (3–255, `422` antes de salvar), não repassá-lo ao endereço, e gravar `users.delivery.update` com ator, cliente, nomes dos campos enviados e `reason`. Verificar: teste de rota/serviço de users (criar `tests/admin-users-delivery.service.test.js` se nenhum cobrir `updateDelivery`), conferindo que o endereço salvo não tem `reason`.

## 4. Busca da fila

- [x] 4.1 `subscription-ledger.repository.js`: o `q` da fila também casa `recipient_name`, `name`, `full_name` e `recipient` do endereço. Verificar: `tests/subscription-ledger.repository.test.js` (SQL e parâmetros) e, com `RUN_DB_INTEGRATION_TESTS=true`, `tests/integration/subscription-ledger-queue.integration.test.js` com um endereço só com `full_name`.

## 5. Fechamento

- [x] 5.1 `npx jest --changedSince=HEAD` e `npm run routes:manifest` sem diff em `docs/api-routes.json`. Verificar: testes verdes e `git diff --exit-code docs/api-routes.json`.
