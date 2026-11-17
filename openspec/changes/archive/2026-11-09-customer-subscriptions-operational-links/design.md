# Design

## Context

- `AdminUsersService.getById` (`src/services/admin-users.service.js:204`) monta `subscriptions` a partir de `scopedSubscriptions`. Esse método já filtra pelo mercado do ator via `ledgerRepository.listByUserId`. Só sai 7 campos da linha do ledger, mas a linha já tem `createdAt`, `subscriptionTermMonths`, `chargedDeliveries`, `autoRenew`, `paymentMethodBrand/Last4` e `shipping`.
- `SubscriptionPaidCyclesService.list` (`src/services/subscription-paid-cycles.service.js`) já junta o ciclo pago com o UPS ativo e o courier. Usa `ledgerRepository.listPaidCyclesBySubscription`, `upsShipmentRepository.listActiveByInvoiceIds` e `courierDeliveryRepository.listByInvoiceIds`. Esse serviço passa por `adminBillingService.getSubscription`, que valida a rota de registro e devolve 404 fora do mercado. Para o detalhe do cliente esse passo sobra, porque a lista já vem filtrada.
- A NF-e fica em `bling-nfe.repository`. `listByStripeInvoices([{ stripeAccount, stripeInvoiceId }])` busca várias de uma vez pelo par único.
- O ator chega com `actor.permissions`. `canReadFiscalData` já é o modelo de campo condicionado por permissão neste payload.
- O frete do checkout já é extraído em `courier-delivery.service.js` (`customerShippingOf`, commit 87e2b9a).

## Goals / Non-Goals

**Goals:**
- Ler o último ciclo de cada assinatura com uma consulta por assinatura e, no máximo, uma consulta em lote para courier, uma para UPS e uma para NF-e, para todas as assinaturas juntas.
- Uma única regra de "último ciclo" e de "entrega mais recente", a mesma da lista de ciclos pagos.

**Non-Goals:**
- Mudar `GET /admin/billing/subscriptions/:id/paid-cycles` ou o seu formato.
- Paginar ou listar mais de um ciclo por assinatura no detalhe do cliente.
- Alertas e regras de prontidão (`readinessReasons`).

## Decisions

### 1. Embutir no `GET /admin/users/:userId`, sem rota nova

O painel já busca esse payload ao abrir o cliente. Uma rota nova por assinatura repetiria N chamadas no painel e mexeria no manifesto e no contrato do painel.

Alternativa considerada: o painel chamar `/paid-cycles` e `/nfe` para cada assinatura. Foi descartada porque gera várias chamadas por cliente e exige `billing.subscribers.read`/`shipping.read` separadamente, com erros 403 por bloco no painel.

### 2. Extrair o núcleo de `SubscriptionPaidCyclesService` sem o `getSubscription`

Criar um método, por exemplo `latestByLedgerRows(rows)`, que recebe as linhas do ledger já filtradas. Ele:
- pede `listPaidCyclesBySubscription(row.id, 1)` para cada uma;
- busca UPS e courier em lote pelos `paidInvoiceId`;
- aplica o mesmo `latestCourier`.

`list` passa a usar o mesmo mapeamento de ciclo, e o formato que ela devolve não muda.

Alternativa considerada: chamar `list()` para cada assinatura e pegar o primeiro item. Foi descartada porque refaz o `getSubscription` (outra leitura e outra checagem de mercado) e busca 24 ciclos para usar 1.

### 3. NF-e lida no `AdminUsersService`, só para `stripeAccount = 'br'`

Depois de obter os ciclos, montar os pares `{ stripeAccount: 'br', stripeInvoiceId }` e chamar `listByStripeInvoices` uma vez. A NF-e só existe no Brasil. Por isso uma assinatura US não ganha a chave `nfe`, o que é diferente de `nfe: null` (ciclo sem nota).

### 4. Formato em camelCase, dentro de `subscriptions[]`

O payload do detalhe do cliente já é camelCase (`stripeSubscriptionId`, `currentPeriodEnd`). Os campos novos seguem a mesma convenção, mesmo que `/paid-cycles` use snake_case:

```js
{
  id, stripeSubscriptionId, stripeAccount, status, currentPeriodEnd, cancelAtPeriodEnd, planLabel, // já existentes
  createdAt, subscriptionTermMonths, chargedDeliveries, autoRenew,
  paymentMethod: { brand, last4 },              // billing.subscribers.read
  checkoutShipping: { label, amount, currency } | null, // billing.subscribers.read
  latestCycle: null | {                          // production.read | shipping.read | nfe.read
    invoiceId, paidAt, preparationDay, deliveryDate,
    production: { status, note },                // production.read
    delivery: null | { kind: 'courier', id, status, outForDeliveryAt, deliveredAt, failedAt }
                   | { kind: 'ups', id, status, trackingNumber },  // shipping.read
    nfe: null | { id, number, series, status, lastError, emailStatus } // nfe.read, só BR
  },
  latestCycleUnavailable: true                   // só quando a leitura falhou
}
```

`delivery`: se houver courier não cancelado, ele vence, senão vale o UPS ativo. Na prática cada mercado só tem um dos dois.

### 5. Reaproveitar `customerShippingOf`

Mover `customerShippingOf` de `courier-delivery.service.js` para um helper em `src/core/` e usar nos dois lugares. `distance_km` fica fora do detalhe do cliente.

### 6. Falha isolada

Toda a montagem de `latestCycle` fica num `try/catch` no `getById`. Se falhar, registra um `logger.warn` com `userId` e o código do erro e marca todas as assinaturas com `latestCycleUnavailable: true`. O resto do detalhe (perfil, endereço, fiscal, papéis) não depende dessas leituras. Granularidade por bloco foi descartada: complica o painel e o caso é raro.

## Risks / Trade-offs

- [Mais consultas ao abrir um cliente] → No máximo 1 por assinatura mais 3 em lote, e só se o ator tiver as permissões. Um cliente tem 1 ou 2 assinaturas.
- [O papel muda o formato do payload] → As chaves ausentes por permissão já são padrão (`fiscal`). Hoje nenhum papel de `ROLE_PERMISSIONS` que passa em `users.read` deixa de ter as quatro permissões, então o corte só passa a valer se os papéis se separarem. Os testes de permissão isolada usam atores sintéticos e documentam essa proteção. Os testes por papel real (admin, operator, readonly) confirmam o payload completo. O painel trata ausência como "sem acesso".
- [Falha em uma leitura marca todas as assinaturas como indisponíveis] → É aceito: as leituras em lote (NF-e, courier, UPS) são comuns a todas as assinaturas. O spec descreve exatamente esse comportamento.
- [Duas leituras do mesmo ciclo podem divergir se a regra mudar em um lugar só] → Decisão 2 deixa uma única função de mapeamento para os dois consumidores.

## Migration Plan

Nenhuma migração de dados. Os campos são aditivos e o painel atual ignora os novos. O rollback é reverter o commit.
