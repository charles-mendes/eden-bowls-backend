# Proposal

## Why

A aba **Assinaturas** do detalhe do cliente (`/users/:id?aba=assinaturas` no painel) mostra só o ID Stripe, o status, o plano, o fim do período e se está cancelando. Para validar um cliente, o operador precisa saber se o último ciclo pago foi produzido, saiu para entrega e teve NF-e. Hoje isso exige abrir cada assinatura em `/billing/subscriptions/:id` ou procurar nas filas de Produção, Entregas Brasil e NF-e.

A API já guarda essas ligações (ciclo pago → `paid_invoice_id` → courier, UPS e NF-e). Só falta entregá-las no detalhe do cliente.

A change irmã em `eden-bowls-admin`, a abrir depois desta, consome o que esta muda.

## What Changes

- **`GET /api/v1/admin/users/:userId`**: cada item de `subscriptions` passa a trazer também:
  - os dados que já estão na assinatura: mercado (`stripeAccount`, que já vinha), início (`createdAt`), contrato (`subscriptionTermMonths`, entregas cobradas, renovação automática), bandeira e final do cartão, e frete pago no checkout (rótulo, valor, moeda);
  - `latestCycle`: o último ciclo pago, com a fatura paga e a data de pagamento, o dia de preparo, a data de entrega, o status e a nota de produção, a entrega (courier no Brasil ou UPS nos EUA) e a NF-e (número, série, status, último erro, status do e-mail), quando existem.
- Cada bloco só aparece para quem tem a permissão da tela de origem:
  - produção: `production.read`;
  - entrega: `shipping.read`;
  - NF-e: `nfe.read`;
  - pagamento e frete do checkout: `billing.subscribers.read`.
  Hoje todo papel que abre o cliente (admin, operator, readonly) já tem as quatro permissões e recebe o payload completo. O corte por permissão é defensivo, no padrão do `fiscal`, para o caso de os papéis se separarem depois. A change do painel esconde cada bloco com `hasPermission`.
- Escopo de mercado: assinaturas de outro mercado continuam fora da lista, como hoje. Os blocos ligados seguem o mercado da assinatura.
- Se a leitura do último ciclo ou de um bloco ligado falhar, o detalhe do cliente carrega mesmo assim e todas as assinaturas do cliente marcam `latestCycleUnavailable: true`. As leituras são feitas juntas, para todas as assinaturas.
- **Sem mudança:**
  - nenhuma rota nova, removida ou renomeada, então `docs/api-routes.json` fica igual;
  - nada chama a Stripe nem o Bling nesta leitura;
  - `GET /admin/billing/subscriptions/:id/paid-cycles` e as outras rotas da assinatura não mudam.
- **Fora do escopo** (follow-up): alertas na linha da assinatura para NF-e ausente ou rejeitada, entrega que falhou, pedido pronto sem despacho e edição pendente.

## Capabilities

### New Capabilities

- `admin-customer-subscriptions`: o que o detalhe do cliente no painel devolve sobre cada assinatura do cliente, incluindo o último ciclo pago e suas ligações com produção, entrega e NF-e.

### Modified Capabilities

Nenhuma. `admin-market-scope` ("Nested customer payloads stay in the actor market") já cobre o escopo dos registros aninhados. `subscription-paid-cycles` não muda de comportamento.

## Impact

- `src/services/admin-users.service.js`: `getById` monta os campos novos.
- `src/index.js`: `AdminUsersService` recebe o leitor de último ciclo extraído de `SubscriptionPaidCyclesService` (que já usa courier e UPS), o repositório de NF-e e um `logger`. O ledger já recebia.
- `src/services/subscription-paid-cycles.service.js`: o mapeamento de ciclo é extraído, e `/paid-cycles` mantém o formato snake_case.
- `src/infrastructure/repositories/subscription-ledger.repository.js`: reaproveita `listPaidCyclesBySubscription`.
- `src/infrastructure/repositories/bling-nfe.repository.js`: reaproveita `listByStripeInvoices`.
- Testes em `tests/admin-users*.service.test.js` e `tests/admin-market-record-scope.routes.test.js`.
- Painel: change irmã em `eden-bowls-admin` para mostrar as colunas e o bloco "Último ciclo" em `UserDetailPage.tsx`.
