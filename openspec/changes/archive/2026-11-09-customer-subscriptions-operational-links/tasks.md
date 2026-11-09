# Tasks

## 1. Helpers compartilhados

- [x] 1.1 Mover `customerShippingOf` de `src/services/courier-delivery.service.js` para um helper em `src/core/` e importar de volta no courier; verificar com `npx jest --runTestsByPath tests/courier-delivery.service.test.js` sem mudança de resultado
- [x] 1.2 Extrair de `SubscriptionPaidCyclesService` o mapeamento ciclo + UPS + courier (`latestCourier` incluído). Criar o método que recebe linhas do ledger já filtradas e devolve o último ciclo de cada uma (`listPaidCyclesBySubscription(id, 1)`, UPS e courier em lote). Verificar que `npx jest --runTestsByPath tests/admin-paid-cycles.routes.test.js` continua passando com o mesmo formato de `/paid-cycles`
- [x] 1.3 Testes unitários do método novo: ciclo mais recente escolhido, assinatura sem ciclo → `null`, courier cancelado ignorado, UPS ativo, uma consulta em lote para várias assinaturas

## 2. Campos da assinatura no detalhe do cliente

- [x] 2.1 Em `AdminUsersService.getById`, adicionar `createdAt`, `subscriptionTermMonths`, `chargedDeliveries` e `autoRenew` (`null` quando ausentes) a cada item de `subscriptions`
- [x] 2.2 Adicionar `paymentMethod` e `checkoutShipping` só com `billing.subscribers.read`, usando o helper de 1.1, sem token de cotação nem `distance_km`
- [x] 2.3 Testes em `tests/admin-users-subscriptions.service.test.js` (novo): contrato preenchido e vazio; com e sem `billing.subscribers.read`; frete sem snapshot → `null`. Rodar com `npx jest --runTestsByPath` nesse arquivo

## 3. Último ciclo com produção, entrega e NF-e

- [x] 3.1 Injetar em `AdminUsersService` (`src/index.js:908`) o serviço de ciclos de 1.2, o `blingNfeRepository` e um `logger`. Manter tudo opcional, para os testes que constroem o serviço sem eles
- [x] 3.2 Montar `latestCycle` só quando o ator tem `production.read`, `shipping.read` ou `nfe.read`. Incluir `production` com `production.read`, `delivery` (courier antes de UPS) com `shipping.read` e `nfe` com `nfe.read`. A NF-e vem de uma chamada a `listByStripeInvoices` com pares `br`, e assinatura US fica sem a chave
- [x] 3.3 Envolver a montagem em `try/catch`: na falha, `logger.warn` com `userId` e o código, e `latestCycleUnavailable: true` em cada assinatura, sem `latestCycle`
- [x] 3.4 Testes no mesmo arquivo de 2.3, um por cenário do spec `admin-customer-subscriptions`:
  - os papéis reais `operator` e `readonly` (via `ROLE_PERMISSIONS`) recebem o payload completo;
  - cada permissão isolada, com ator sintético, como proteção para uma separação futura dos papéis;
  - sem permissão nenhuma, sem chave;
  - courier e UPS na mesma fatura → `kind: "courier"`;
  - leituras bem-sucedidas → nenhuma assinatura com `latestCycleUnavailable`;
  - ciclo `null`;
  - nota rejeitada com `lastError`;
  - ciclo sem nota;
  - assinatura US sem `nfe`;
  - falha da NF-e → `200` com `latestCycleUnavailable`.
- [x] 3.5 Em `tests/admin-market-record-scope.routes.test.js`, adicionar o caso: operador `BR` abre cliente com assinatura BR e US, e só a BR aparece com `latestCycle`. Rodar o arquivo com `npx jest --runTestsByPath`

## 4. Verificação integrada

- [x] 4.1 `npx jest --findRelatedTests src/services/admin-users.service.js src/services/subscription-paid-cycles.service.js src/services/courier-delivery.service.js` passa
- [x] 4.2 `npx jest --runTestsByPath tests/api-routes-manifest.test.js` passa sem mudar `docs/api-routes.json`, confirmando que não há rota nova
- [ ] 4.3 Checagem manual, não automatizada: escolher no backend local um cliente com assinatura BR paga (o usuário 5, se tiver uma). Com um admin, conferir que `GET /api/v1/admin/users/:userId` devolve `latestCycle` com produção, entrega e NF-e
- [x] 4.4 Abrir a change irmã em `eden-bowls-admin` para as colunas e o bloco "Último ciclo" em `UserDetailPage.tsx`, apontando para este formato
