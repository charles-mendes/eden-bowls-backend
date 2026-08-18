# Rota: listar assinaturas (dashboard)

## Escopo

Rota atual no backend Node:

- `GET /api/v1/subscriptions`

Front:

- `eden-bowls/src/services/onboardingApi.ts` (`fetchUserSubscriptions`)
- `MyPlan.tsx`, `Plan.tsx`, `PlanDetail.tsx`

Arquivos atuais (stub):

- `src/api/routes/subscriptions.routes.js` — `registerSubscriptionsRoutes`
- `src/services/subscriptions.service.js` — `SubscriptionsService.listMine`
- `src/infrastructure/repositories/subscriptions.repository.js` — **ignora `userId`**, devolve `{ subscriptions: [], count: 0 }`
- `tests/subscriptions.routes.test.js` — cobre JWT 401 e envelope 200 com service mockado

Rota legado WordPress:

- `GET /custom/v1/subscriptions`

## Responsabilidade

Listar as assinaturas do usuario autenticado para Meu Plano e para decidir se a tela Plan ainda oferece checkout.

Nao e CRUD. Nao recalcula preco. Projeta estado ja persistido no ledger.

## Estado de implementacao

| Parte | Status |
|---|---|
| Rota + JWT 401 | implementado |
| Envelope `{ success, data }` | implementado |
| Leitura de banco / Stripe | **stub vazio** |
| Wiring `src/index.js` | `new SubscriptionsRepository()` **sem** DataSource |

Depois de um Place Order pago, Meu Plano aparece vazio ate o ledger existir e esta rota ler.

## Endpoint, controller e permissao

- Path: `/api/v1/subscriptions`
- Method: `GET`
- Registrar: `registerSubscriptionsRoutes` (ja em `src/app.js`)
- Service: `SubscriptionsService.listMine({ userId })`

Sem `currentUser.id` → `401 unauthorized`. Sem service → `503`.

HttpError com `details.code` nesta rota **devolve** `details` no JSON.

## Auth

```http
GET /api/v1/subscriptions
Authorization: Bearer <jwt>
```

Sem query, sem body. Rate limit: o global do Express (`300/min`). **Nao** exigir Woo. **Nao** replicar `503 woocommerce_required`.

## Fluxo alvo

Woo **nao** entra.

1. JWT → `userId`.
2. `SubscriptionLedgerRepository.listByUserId(userId)`.
3. Ignorar linhas sem `sub_`.
4. Dedup por `stripe_subscription_id`.
5. Ordenar por recencia (`updated_at` / `current_period_end` DESC).
6. Formatar o shape `DashboardSubscription` (snake_case).
7. Opcional: `StripeBillingClient.listByCustomer(cus_)` para status fresco; ledger continua a fonte de pets/`plan_label`.

Checkout deve inserir a linha `incomplete` no create; `invoice.paid` promove para `active`. Sem o passo de escrita, esta GET permanece vazia mesmo com Stripe cobrando.

## Response

Contrato TS: `DashboardSubscription` em `onboardingApi.ts`. Envelope:

```json
{
  "success": true,
  "data": {
    "subscriptions": [
      {
        "subscription_id": "sub_123",
        "stripe_subscription_id": "sub_123",
        "legacy_subscription_id": null,
        "slug": "sub_123",
        "plan_label": "Plan #1",
        "status": "active",
        "stripe_subscription_status": "active",
        "contract_label": "Plan #1",
        "start_date": "2026-01-01T00:00:00.000Z",
        "end_date": null,
        "end_date_source": null,
        "current_period_start": "2026-08-01T00:00:00.000Z",
        "current_period_end": "2026-09-01T00:00:00.000Z",
        "next_billing_date": "2026-09-01T00:00:00.000Z",
        "next_billing_source": "stripe",
        "next_shipment_date": "2026-08-15T00:00:00.000Z",
        "next_shipment_source": "plan_selection",
        "next_shipment_context": { "shipping_window": "weekly" },
        "pets_names": ["Milo"],
        "pet_ids": ["pet_1"],
        "packs_per_month": 2,
        "order_total_per_month": 60
      }
    ],
    "count": 1
  }
}
```

O front so usa `json.data.subscriptions` (array). `count` e documentacao/debug.

`subscription_id` e `stripe_subscription_id` sao o mesmo id logico (`sub_...`). O front navega com esse valor para `/dashboard/plans/:id`.

`slug`: usar o `sub_` (o stub de detalhe usa `premium-plan` — **nao** copiar isso na listagem).

Datas: strings ISO.

`plan_label`: snapshot do ledger; fallback `Plan #n` se vazio.

## Regras a preservar

1. Fonte primaria = ledger alimentado pelo checkout/webhook.
2. Sem `sub_` → nao listar.
3. Dedup por `sub_`.
4. Fallback email **nao** precisa no ledger novo (eligibility legado WP ainda faz; listagem JWT tem `user_id`).
5. `Plan.tsx` usa a lista para bloquear novo checkout se ja houver assinatura ativa — depende desta rota + eligibility.
6. Lista vazia e **200** `{ subscriptions: [], count: 0 }`, nao 404.

## Erros

| Caso | Status | code |
|---|---|---|
| Sem JWT | 401 | `unauthorized` |
| Service ausente | 503 | (mensagem) |

## O que mudar no repository

Hoje:

```js
async listMine() {
  return { subscriptions: [], count: 0 };
}
```

Alvo: `async listMine({ userId })` — **usar** `userId`. Construtor recebe `ledgerRepository`. Mapear linhas → shape acima. `next_shipment_*` pode vir de `plan_selection` / `shipping` JSON do ledger; se ausente, `null` / omitir.

## Testes minimos

Alem dos testes de rota ja existentes (JWT):

- user sem ledger → `{ subscriptions: [], count: 0 }`
- apos insert incomplete + `invoice.paid` → 1 item `active` com o `sub_` do checkout
- duas linhas mesmo `sub_` → `count: 1`
- user A nao ve `sub_` do user B
- `listMine` e chamado com `{ userId }` (o teste de rota ja espera isso)
