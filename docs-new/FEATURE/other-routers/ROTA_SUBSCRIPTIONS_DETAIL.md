# Rota: detalhe da assinatura

## Escopo

Rota atual no backend Node:

- `GET /api/v1/subscriptions/:subscriptionId/detail`

Front:

- `fetchUserSubscriptionDetail` em `onboardingApi.ts`
- `PlanDetail.tsx`, `EditSubscription.tsx`

Arquivos atuais (stub):

- `src/api/routes/subscriptions-detail.routes.js`
- `src/services/subscriptions-detail.service.js` — valida `sub_` (`/^sub_[A-Za-z0-9]+$/`); **nao** 404 se o repo inventar
- `src/infrastructure/repositories/subscriptions-detail.repository.js` — ignora banco; Premium / Milo / Visa 4242 / `subscription_id` do path
- `tests/subscriptions-detail.routes.test.js`

Rota legado WordPress:

- `GET /custom/v1/subscriptions/:subscriptionId/detail`

## Responsabilidade

Devolver o detalhe rico de **uma** assinatura do usuario: pets, ciclo, cartao, endereco, historico, itens do plano, flag `edit_payment_pending`.

Fonte da tela de detalhe e da tela de edicao. Sem este shape, o Edit nao sabe termo, pets nem se ha pagamento de edicao pendente.

## Estado de implementacao

| Parte | Status |
|---|---|
| JWT + regex `sub_` → 422 | implementado no service |
| Ownership / 404 | **nao** — qualquer JWT ve qualquer `sub_` fake |
| Banco / Stripe | stub |

## Endpoint e auth

- Path: `/api/v1/subscriptions/:subscriptionId/detail`
- Method: `GET`
- Registrar: `registerSubscriptionsDetailRoutes`
- Service: `SubscriptionsDetailService.getDetail({ subscriptionId, userId })`

JWT obrigatorio. `subscription_id` tem de ser `sub_...` do usuario.

```http
GET /api/v1/subscriptions/sub_123/detail
Authorization: Bearer <jwt>
```

## Fluxo alvo

1. JWT + validar `sub_` (ja existe).
2. Ledger por `(user_id, stripe_subscription_id)`.
3. Enriquecer com `onboarding_pets`, `plan_selection`, `address`, `shipping` **do snapshot do ledger** (nao do onboarding atual, que pode ter mudado). Fallback: colunas atuais de `onboarding_user_state` so se o snapshot estiver vazio e ainda for o mesmo user.
4. Opcional: `subscriptions.retrieve` + invoices list para `billing_history` / `stripe_timeline` / last4 atuais.
5. Se nao achar linha do user → o repository devolve `null` e o **service** lanca `404 subscription_not_found`. Nao devolver stub.

## Response

Contrato TS: `DashboardSubscriptionDetail`. Envelope `{ success, data: { subscription } }` — o front le `json.data.subscription`.

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
- `auto_renew` — `!cancel_at_period_end`
- `next_billing_date` / `next_shipment_date`
- `order_total_per_month` / `price_per_cycle`

Preferir sempre o shape rico (`null`/`[]` se nao houver dado), para o Edit nao quebrar. `next_shipment_context` e **objeto**, nao string.

`subscription_id` === `stripe_subscription_id`.

## Erros

| Caso | Status | code |
|---|---|---|
| Sem JWT | 401 | `unauthorized` |
| id vazio / nao `sub_` | 422 | `invalid_subscription_id` |
| nao encontrada / outro user | 404 | `subscription_not_found` |

Ownership: **404, nao 403**, para sub alheia (nao vazar existencia).

## Persistencia

Ledger JSON + colunas de `onboarding_user_state` + retrieve Stripe pontual.

`edit_payment_pending` vive no ledger (escrita no commit / limpeza no webhook).

## O que mudar no service

Hoje o service sempre envelopa o que o repository devolve. Alvo:

```js
const data = await this.repository.getDetail(userId, subscriptionId);
if (!data || !data.subscription) {
  throw new HttpError(404, 'Subscription not found.', { code: 'subscription_not_found' });
}
```

## Testes minimos

- sem JWT → 401 (ja existe)
- id `abc` → 422
- `sub_inexistente` do user → 404
- `sub_` de outro user → 404
- apos webhook paid → 200 com `status: active` e o `sub_` real
- `edit_payment_pending: true` quando o commit deixou pendencia
- **nao** devolver Premium/Milo hardcoded
