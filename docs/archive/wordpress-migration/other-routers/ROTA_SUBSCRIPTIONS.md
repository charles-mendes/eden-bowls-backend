# Rota: listar assinaturas (dashboard)

## Escopo

Rota legado WordPress:

- `GET /custom/v1/subscriptions`

Rota atual Node (stub):

- `GET /api/v1/subscriptions`

Front:

- `eden-bowls/src/services/onboardingApi.ts` (`fetchUserSubscriptions`)
- `MyPlan.tsx`, `Plan.tsx`, `PlanDetail.tsx`

WP: `StripeSubscriptionApi::get_user_subscriptions` (`pawbowl-stripe-billing`).

Analise longa: `docs/rotes/ANALISE_MIGRACAO_ROTA_SUBSCRIPTIONS.md`.

## Responsabilidade

Listar as assinaturas do usuario autenticado para Meu Plano e para decidir se a tela Plan ainda oferece checkout.

Nao e CRUD. Nao recalcula preco. Projeta estado ja persistido.

## Estado de implementacao Node

`SubscriptionsRepository.listMine()` devolve `{ subscriptions: [], count: 0 }` sempre. Depois de um Place Order pago, Meu Plano aparece vazio.

## Auth

WP: usuario logado, rate limit 60 / 300s, Woo obrigatorio (503 `woocommerce_required`).

Node alvo: JWT obrigatorio. Sem `currentUser.id` → `401 unauthorized`. **Nao** exigir Woo. Rate limit: o global do Express cobre; bucket por user e opcional.

## Fluxo WP

1. `wc_get_orders({ type: fsb_subscription, customer_id, status: any, orderby: date DESC })`
2. Para cada order, resolve `_hsr_stripe_subscription_id`. Sem `sub_` → **ignora**.
3. Formata item de dashboard.
4. Consulta `wp_hsr_stripe_subscriptions WHERE wp_user_id = ? ORDER BY updated_at DESC LIMIT 200`.
5. Fallback por email se `wp_user_id` vazio (backfill).
6. Dedup em memoria por `stripe_subscription_id` (Woo ganha se os dois existirem).
7. Envelope `{ success, data: { subscriptions, count } }`. Sem paginacao.

## Fluxo alvo Node

Woo **nao** entra.

1. JWT → `userId`.
2. Ler ledger por `user_id` (tabela `wp_hsr_stripe_subscriptions` se DB compartilhado, ou equivalente Node).
3. Opcional: `subscriptions.list({ customer: cus_ })` para status fresco; ledger continua a fonte de pets/plan_label se o Stripe nao tiver metadata.
4. Ignorar linhas sem `sub_`.
5. Dedup por `stripe_subscription_id`.
6. Ordenar por recencia (`current_period_end` / `updated_at` DESC).
7. Formatar o shape que o front ja espera (snake_case).

Checkout deve inserir a linha `incomplete` no create; `invoice.paid` promove para `active`. Sem o passo de escrita, esta GET permanece vazia mesmo com Stripe cobrando.

## Request

```http
GET /api/v1/subscriptions
Authorization: Bearer <jwt>
```

Sem query, sem body.

## Response

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

`subscription_id` e `stripe_subscription_id` sao o mesmo id logico (`sub_...`). O front navega com esse valor para `/dashboard/plans/:id`.

`slug` no WP e derivado do `sub_`. `plan_label` pode ser `Plan #n` se nao houver label persistida.

Datas: strings ISO (o PHP formatava para UI; o front Node ja parseia ISO).

## Regras WP a preservar

1. Duas fontes no PHP (Woo + ledger) existem para nao perder legado. No Node a fonte primaria e o ledger alimentado pelo checkout/webhook.
2. Sem `sub_` → nao listar.
3. Dedup por `sub_`.
4. Fallback email so se ainda existirem linhas WP antigas sem `user_id`. Nao precisa inventar no ledger novo.
5. `Plan.tsx` usa a lista para bloquear novo checkout se ja houver assinatura ativa — depende desta rota + eligibility.

## Persistencia

WP: `wp_posts` (`fsb_subscription`) + `wp_postmeta` + `wp_hsr_stripe_subscriptions`.

Node alvo: ledger + opcionalmente `onboarding_user_state.plan_selection` / pets para `pets_names`.

## Erros

| Caso | Status | code |
|---|---|---|
| Sem JWT | 401 | `unauthorized` |
| WP: Woo down | 503 | `woocommerce_required` — **nao replicar** |
| WP: rate limit | 429 | `rate_limit` |

Lista vazia e **200** `{ subscriptions: [], count: 0 }`, nao 404.

## O que mudou em relacao ao WordPress

| Antes (WP) | Alvo (Node) |
|---|---|
| merge Woo + ledger | so ledger / Stripe |
| 503 se Woo down | irrelevante |
| `x-session-token` aceito em docs antigas de front | so Bearer JWT |

## Testes minimos

- sem JWT → 401
- user sem ledger → `{ [], 0 }`
- apos `invoice.paid` → 1 item `active` com o `sub_` do checkout
- duas linhas mesmo `sub_` → `count: 1`
- user A nao ve `sub_` do user B
