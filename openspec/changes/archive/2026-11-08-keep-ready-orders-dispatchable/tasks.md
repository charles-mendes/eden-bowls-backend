## 1. Pronto do Brasil fica na fila até sair

- [x] 1.1 Em `queueMembership` (`src/infrastructure/repositories/subscription-ledger.repository.js`), adicionar o caso do pronto do Brasil à parte de atrasados: pago, `ready`, `paid_invoice_id` presente, `due_at >= overdueFloor`, `shipmentMarketSql('BR')` e `courierOpenSql(courierTableName)`. Receber `courierTableName` (padrão `courier_deliveries`) e repassá-lo de `listQueue`, `listQueueDemandRows` e `listQueueMetricRows`.
- [x] 1.2 No serviço da fila (`src/services/admin-production.service.js`) e no Hoje (`src/services/admin-today.service.js`), passar o nome da tabela de entregas ao repositório quando ele estiver disponível.
- [x] 1.3 Testes de SQL em `tests/subscription-ledger.repository.test.js`: a parte de atrasados aceita o pronto do Brasil com o piso, o mercado e a entrega aberta.
- [x] 1.4 Testes de integração em `tests/integration/subscription-ledger-queue.integration.test.js` (com `RUN_DB_INTEGRATION_TESTS=true`). O ciclo de dezembro de 2026 cobre quatro casos:
  - pronto atrasado sem entrega, que fica;
  - pronto com entrega em rota, que sai;
  - pronto com 31 dias, que sai;
  - pronto dos EUA, que sai.

## 2. Atrasados contam só o preparo atrasado

- [x] 2.1 Em `admin-production.service.js`, a métrica `overdue` passa a pular linhas `ready`. Teste em `tests/admin-production.service.test.js`.
- [x] 2.2 Em `admin-today.service.js`, os totais `overdue` (geral e por mercado) passam a pular itens `ready`. Teste em `tests/admin-today.service.test.js`: um pronto atrasado não entra em `overdue`.

## 3. Hoje conta os travados por endereço

- [x] 3.1 Extrair o `where` de `countPaidCourierCyclesToDispatch` para um helper. Usá-lo também numa nova `listPaidCourierCycleAddresses(query)`, que devolve só os endereços. Testes em `tests/subscription-ledger.courier.test.js`.
- [x] 3.2 Em `countQueue` (`src/services/courier-delivery.service.js`), devolver `addressLocked`: a contagem de `brazilAddressIssues` não vazio sobre os endereços da conta a despachar. Vale 0 fora do escopo e no retorno `zero`. Teste em `tests/courier-delivery.service.test.js`.
- [x] 3.3 Em `admin-today.service.js`, expor `fulfillment.courierAddressLocked`. Testes: 3 a despachar com 2 travados, e operador dos EUA com 0.

## 4. A trava aparece no item da fila e no detalhe

- [x] 4.1 Em `src/core/production-queue-presenter.js`, adicionar `courierIssues`: `brazilAddressIssues(row.address)` para conta `br` com país `BR`, e `null` nos outros casos. Testes em `tests/production-queue-presenter.test.js`.
- [x] 4.2 Em `AdminBillingService.getSubscription`, adicionar `courier_issues` quando `detail` é verdadeiro e o mercado de envio é `BR`, e `null` nos outros casos. Não pode abrir problema nem mandar e-mail. Teste em `tests/admin-billing.shipment-market.test.js`.
- [x] 4.3 Teste em `tests/admin-production.service.test.js`: marcar `ready` um ciclo do Brasil sem nome de quem recebe não chama o serviço de problemas de endereço (nenhum problema, nenhum e-mail). O mesmo vale para a leitura do Hoje e do detalhe.

## 5. Fechamento

- [x] 5.1 Rodar `npx jest --findRelatedTests` sobre os arquivos alterados e a integração da fila com o banco. O manifesto de rotas não muda: confirmar com `npx jest --runTestsByPath tests/api-routes-manifest.test.js`.
- [x] 5.2 Testar no painel local com o operador do Brasil:
  - marcar pronto um pedido atrasado;
  - ver o Expedir;
  - ver "travados por endereço" no Hoje.
