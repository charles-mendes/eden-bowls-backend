# Tasks

Rode só os testes relacionados (`npx jest --runTestsByPath …` ou `--findRelatedTests`). Integração MySQL só no arquivo afetado, com `RUN_DB_INTEGRATION_TESTS=true`.

## 1. Filas por período de entrega (PM-29)

- [x] 1.1 `src/core/delivery-range.js`:
  - `from`/`to` opcionais, hoje no fuso dado, piso de 30 dias, teto de 31 dias;
  - devolve `{ from, to, default }` ou lança `400 invalid_delivery_range`.

  Verificar: `tests/delivery-range.test.js` novo (o padrão, hoje − 30 até amanhã, passa com 31 dias; 32 é recusado; data inválida; `from` > `to`; antes do piso; virada do dia em São Paulo e em Nova York).
- [x] 1.2 Repositório do ledger:
  - `listPaidCourierCycles` aceita `deliveryCeiling` e exclui na SQL a fatura com entrega em rota, entregue ou com falha (o `NOT EXISTS` da contagem);
  - `listPaidLabelCycles` aceita `deliveryCeiling` e traz só ciclos sem etiqueta fora de `voided`;
  - consulta nova `listLabelCyclesWithActiveShipment({ deliveryFloor })` (`pending`, `unknown`, `created`), sem teto e sem limite de 100;
  - `countPaidCourierCyclesToDispatch` aceita `deliveryCeiling`;
  - contagem nova dos ciclos de etiqueta sem etiqueta ativa depois de uma data.

  Verificar:
  - `tests/subscription-ledger.repository.test.js` e `tests/subscription-ledger.courier.test.js` (SQL e parâmetros);
  - no courier, um mês com mais de 200 ciclos já entregues não tira vaga de "A despachar";
  - `RUN_DB_INTEGRATION_TESTS=true npx jest --runTestsByPath tests/integration/subscription-ledger-queue.integration.test.js`, com uma etiqueta criada depois do teto, cem prontos mais uma criada e um caso de collation.
- [x] 1.3 Courier:
  - `listQueue(actor, query)` usa o período só em "A despachar" e devolve `range`, `later` e `next_from`;
  - `countQueue` conta até amanhã;
  - a rota lê `from`/`to`.

  Verificar:
  - `tests/courier-delivery.service.test.js`: padrão, depois do período, recorte com corte, "Em rota" fora do período;
  - `tests/admin-courier-deliveries.routes.test.js`: query repassada e `400`.
- [x] 1.4 Etiquetas:
  - `listLabelQueue(actor, query)` com o período e o piso no fuso de Nova York;
  - prontos da consulta com limite; criadas e sem confirmação da consulta própria, em qualquer recorte;
  - `range`, `later` e `next_from`;
  - a rota lê `from`/`to`.

  Verificar: `tests/ups-label-queue.test.js` e `tests/admin-shipments-queue.routes.test.js` (padrão, depois do período, etiqueta criada depois do teto, período longo).

## 2. Prévia do bloqueio (PM-15)

- [x] 2.1 `CustomerDeliveriesService`: extrair `planFor` de `onProductionStatus` e criar `previewBlock`, que não chama a Stripe.
  - Verificar: `tests/customer-deliveries.service.test.js` (a prévia e o bloqueio dão o mesmo `trial_end`, e a prévia não chama `setTrialEnd`).
- [x] 2.2 `AdminProductionService`:
  - extrair `resolveCycle` de `updateStatus`;
  - `previewBlock(id, periodEnd, actor)` devolve `{ charged, chargeMovesTo, preparationDay }`.

  Verificar: `tests/admin-production.service.test.js`:
  - não pago;
  - pago;
  - `production_period_stale`;
  - fora do escopo;
  - nada é gravado nem auditado.
- [x] 2.3 Rota `GET /api/v1/admin/production/queue/:id/block-preview` (`production.write`, `market: 'record'`) e `npm run routes:manifest`.
  - Verificar: `tests/admin-production.routes.test.js` (permissão, `periodEnd` na query, `404`) e `tests/api-routes-manifest.test.js`.

## 3. Receitas em falta (PM-09)

- [x] 3.1 `allocateCoverage` devolve `{ coverage, shortages }` com `missing`. `queueCoverage` repassa. A fila de produção põe `stockShortages` com o nome da receita, e a lista fica vazia fora de `short`.
  - Verificar: `tests/pack-stock.core.test.js` (a anterior leva o saldo; duas receitas em falta) e `tests/admin-production.service.test.js` com `stockShortages`.

## 4. Hoje, segunda etapa (PM-26)

- [x] 4.1 `countOpenByAccount` no repositório de problemas de endereço e `countMarketExceptions` no ledger, com o `WHERE` de `listMarketExceptions` extraído.
  - Verificar: `tests/subscription-ledger.repository.test.js` e `RUN_DB_INTEGRATION_TESTS=true npx jest --runTestsByPath tests/integration/delivery-address-issues.integration.test.js`.
- [x] 4.2 `AdminTodayService.fulfillment` ganha `addressIssues` (`BR`/`US`, `open`/`stale`) e `marketExceptions` (`BR`/`US`), no escopo do operador, com a injeção em `src/index.js`.
  - Verificar: `tests/admin-today.service.test.js` (por mercado, `stale` a partir de 72 h e não antes, fechados fora, exceções acima de 200, operador com escopo, sem repositório = 0).

## 5. Fechamento

- [x] 5.1 `npx jest --changedSince=HEAD`, as integrações afetadas e `docs/api-routes.json` commitado com a rota nova.
  - Verificar: tudo passa e o manifesto lista `GET /api/v1/admin/production/queue/:id/block-preview`.
