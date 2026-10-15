# Rota: detalhe da assinatura

## Escopo

Rota legado WordPress:

- `GET /custom/v1/subscriptions/:subscriptionId/detail`

Rota atual Node (stub):

- `GET /api/v1/subscriptions/:subscriptionId/detail`

Front:

- `fetchUserSubscriptionDetail` em `onboardingApi.ts`
- `PlanDetail.tsx`, `EditSubscription.tsx`

WP: `StripeSubscriptionApi::get_user_subscription_detail`.

Analise longa: `docs/rotes/ANALISE_MIGRACAO_ROTA_SUBSCRIPTIONS_DETAIL.md`.

## Responsabilidade

Devolver o detalhe rico de **uma** assinatura do usuario: pets, ciclo, cartao, endereco, historico, itens do plano, flag `edit_payment_pending`.

Fonte da tela de detalhe e da tela de edicao. Sem este shape, o Edit nao sabe termo, pets nem se ha pagamento de edicao pendente.

## Estado de implementacao Node

`SubscriptionsDetailRepository.getDetail` ignora o banco e devolve Premium / Milo / Visa 4242 / `subscription_id` do path. Qualquer `sub_` "existe" para qualquer JWT.

## Auth

JWT obrigatorio. `subscription_id` tem de ser `sub_...` do usuario.

WP: 422 `invalid_subscription_id`, 404 `subscription_not_found` (inexistente **ou** de outro user — nao vazar existencia), rate 60 / 300s.

## Fluxo WP

1. Sanitiza `subscription_id` (`sub_`).
2. Procura `fsb_subscription` do customer com aquele `_hsr_stripe_subscription_id`.
3. Se achar: formata detalhe completo (pets, billing_history, plan_items, stripe_timeline, payment method, address, `edit_payment_pending`, `subscription_term_months`).
4. Se nao: ledger `wp_hsr_stripe_subscriptions` por `sub_` + `wp_user_id` (fallback email). Shape **mais pobre** (sem billing_history / plan_items ricos).
5. Nenhum dos dois → 404.

## Fluxo alvo Node

1. JWT + validar `sub_`.
2. Ledger por `(user_id, stripe_subscription_id)`.
3. Enriquecer com `onboarding_pets`, `plan_selection`, `address`, `shipping` se ainda forem do mesmo usuario/plano.
4. Opcional: `subscriptions.retrieve` + invoices list para `billing_history` / `stripe_timeline` / last4 atuais.
5. 404 se nao for do user. Nao devolver stub.

## Path param

- `subscriptionId`: string `sub_...` (o front manda o mesmo valor de `subscription_id` da lista)

## Response (Woo/local — shape que o front consome)

```json
{
  "success": true,
  "data": {
    "subscription": {
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
      "pets": [{ "id": "pet_1", "name": "Milo" }],
      "packs_per_month": 2,
      "order_total_per_month": 60,
      "packs_per_delivery": 2,
      "frequency": "monthly",
      "active_flavors": ["chicken"],
      "price_per_cycle": 30,
      "cycle_unit": "month",
      "payment_method_brand": "visa",
      "payment_method_last4": "4242",
      "delivery_address": "Rua Teste, 123",
      "auto_renew": true,
      "current_cycle": 1,
      "total_cycles": 3,
      "billing_history": [],
      "plan_items": [],
      "plan_items_source": "plan_selection",
      "stripe_timeline": [],
      "edit_payment_pending": false,
      "subscription_term_months": 1
    }
  }
}
```

Campos que o front usa de verdade:

- `status` / `stripe_subscription_status` — mapeia active / paused / cancelled / payment_pending
- `edit_payment_pending` — bloqueia Edit (`EditSubscription.tsx` tela "Payment pending")
- `subscription_term_months` — 1 | 3 | 6
- `pets` / `pets_names` / `active_flavors`
- `payment_method_brand` / `last4`
- `auto_renew`
- `next_billing_date` / `next_shipment_date`
- `order_total_per_month` / `price_per_cycle`

Fallback ledger no WP omite varios desses. No Node, preferir sempre o shape rico (null/[] se nao houver dado), para o Edit nao quebrar.

## Regras WP a preservar

1. Preferir estado local/ledger do **user**, nao um retrieve Stripe cego (outro customer).
2. `subscription_id` === `stripe_subscription_id`.
3. `edit_payment_pending` controla UX de edicao.
4. `next_shipment_context` e objeto, nao string.
5. Ownership: 404, nao 403, para sub alheia.

## Erros

| Caso | Status | code |
|---|---|---|
| Sem JWT | 401 | `unauthorized` |
| id vazio / nao `sub_` | 422 | `invalid_subscription_id` |
| nao encontrada / outro user | 404 | `subscription_not_found` |

## Persistencia

WP: metas `_hsr_stripe_*`, `_hsr_onboarding_pets`, `_hsr_subscription_term_months`, `_hsr_edit_payment_pending`, `_hsr_payment_method_*`.

Node: ledger JSON + colunas de `onboarding_user_state` + retrieve Stripe pontual.

## O que mudou em relacao ao WordPress

| Antes (WP) | Alvo (Node) |
|---|---|
| detalhe Woo primeiro, ledger depois | ledger primeiro |
| stub Node devolve plano fake | 404 se nao houver linha |

## Testes minimos

- sem JWT → 401
- `sub_inexistente` do user → 404
- `sub_` de outro user → 404
- apos webhook paid → 200 com `status: active` e o `sub_` real
- `edit_payment_pending: true` quando o commit deixou pendencia
