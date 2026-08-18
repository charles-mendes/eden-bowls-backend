# Rota: preview de edicao da assinatura

## Escopo

Rota legado WordPress:

- `POST /custom/v1/subscriptions/:subscriptionId/edit/preview`

Rota atual Node (stub):

- `POST /api/v1/subscriptions/:subscriptionId/edit/preview`

Front:

- `previewSubscriptionEdit` em `subscriptionEditApi.ts`
- `EditSubscription.tsx` (`runPreview` → passo review)

WP: `StripeSubscriptionApi::subscription_edit_preview` → `StripeSubscriptionEditService::preview`.

Analise longa: `docs/rotes/ANALISE_MIGRACAO_ROTA_SUBSCRIPTIONS_EDIT_PREVIEW.md`.

## Responsabilidade

Simular a edicao **sem persistir**. Devolve estado atual, estado proposto, hash de consistencia, prorrata e totais do proximo ciclo.

O commit posterior **exige** `expected_current_hash` desta resposta. Preview e commit sao um par.

## Estado de implementacao Node

`SubscriptionsEditPreviewRepository.preview` devolve `expected_current_hash: 'hash-123'`, prorrata `none`, next_cycle `30 USD`, discount sempre inelegivel. Nao le Stripe, nao valida pets, nao bloqueia `edit_payment_pending`.

## Auth

JWT obrigatorio. WP rate 40 / 300s.

## Validacoes WP (portar)

| Regra | Erro |
|---|---|
| Usuario logado | 401 `unauthorized` |
| `sub_` valido | 422 `invalid_subscription_id` |
| Ownership | 404 `subscription_not_found` |
| Assinatura cancelada | 422 `subscription_not_editable` |
| `_hsr_edit_payment_pending` | 409 `edit_payment_pending` |
| `subscription_term_months` ∈ {1, 3, 6} | 422 `invalid_subscription_term` |
| Pet enabled sem sabor/peso > 0 | 422 `invalid_plan` |
| Catalogo nao resolve price | 422 `catalog_pricing_unavailable` |
| Pet ja em outra sub ativa | 422 `pet_blocked` |
| Lista Stripe vazia | 422 `invalid_plan` |

O front trata `edit_payment_pending` com copy de "update your card or cancel".

## Fluxo WP

1. Carrega `fsb_subscription` do user.
2. `assert_editable`.
3. Resolve plano proposto (termo + pets + sabores + pack) via catalogo meal-plan (`CMPB_Meal_Plan_Service`).
4. `subscriptions.retrieve` com `expand[]=items.data.price`.
5. `build_current_hash` do estado atual (items + termo + address + shipping).
6. `preview_proration` (charge / credit / none).
7. Se address US: `preview_subscription_invoice` (Stripe Tax) para `next_cycle`.
8. Discount **sempre** `{ eligible: false, reason: edit_no_first_purchase_promo, percent: 0 }`. Cupom de 1a compra **nao** vale em edicao.

Nao grava `_hsr_edit_pending_*`. Isso e o commit.

## Fluxo alvo Node

Mesma sequencia, catalogo = o que `POST /onboarding/plan/preview` ja usa (nao CMPB PHP). Hash tem de ser o **mesmo algoritmo** que o commit vai recompute. Se o preview gerar `hash-123` fixo, qualquer commit aceita estado stale.

US: reusar o client de `subscription/preview` (Invoice Preview + automatic tax).

BR: next_cycle sem tax Stripe; shipping do snapshot proposto.

## Request

O front manda `SubscriptionEditPayload`:

```json
{
  "subscription_term_months": 1,
  "pets": [
    {
      "pet_id": "pet_1",
      "pet_name": "Milo",
      "enabled": true,
      "selected_flavors": ["chicken"],
      "flavor_weights": [100]
    }
  ],
  "address": {
    "country": "US",
    "state": "CA",
    "postal_code": "94105"
  },
  "shipping": {
    "method_id": "ship_1",
    "label": "FedEx 3-5 business days",
    "cost": 12.9,
    "tax_total": 0,
    "total": 12.9
  },
  "payment_method_id": "pm_123"
}
```

`expected_current_hash` na preview e opcional (a UI usa o da **resposta** no commit). `payment_method_id` entra na projecao; o attach real e `/actions` + commit.

## Response

```json
{
  "success": true,
  "data": {
    "subscription_id": "sub_123",
    "expected_current_hash": "sha256-...",
    "term_change": false,
    "current": {
      "subscription_term_months": 1,
      "items": [],
      "address": {},
      "status": "active"
    },
    "proposed": {
      "subscription_term_months": 1,
      "items": [],
      "address": {},
      "plan_selection": {}
    },
    "proration": {
      "direction": "none",
      "amount_due_now": 0,
      "credit_applied": 0,
      "currency": "USD"
    },
    "next_cycle": {
      "subtotal": 30,
      "tax": 0,
      "total": 30,
      "currency": "USD"
    },
    "discount": {
      "eligible": false,
      "reason": "edit_no_first_purchase_promo",
      "percent": 0
    }
  }
}
```

`proration.direction`: `charge` | `credit` | `none`. O Edit monta copy ("You will be charged … now" / credit / "No immediate charge").

`term_change` altera a logica de prorrata — nao e so um flag de UI.

## Regras WP a preservar

1. Preview e read-only.
2. Hash e a trava de concorrencia do commit (`409 subscription_state_changed`).
3. Edicao nunca reaplicia promo de 1a compra.
4. `edit_payment_pending` bloqueia **antes** de calcular.
5. Pais muda catalogo e tax (US invoice preview).

## Persistencia

Nenhuma nesta rota. Le metas/ledger/catalogo/Stripe.

WP ainda le `_hsr_edit_payment_pending`, `_hsr_onboarding_plan_selection`, `_hsr_subscription_term_months`, `_hsr_shipping_*`.

## O que mudou em relacao ao WordPress

| Antes (WP) | Alvo (Node) |
|---|---|
| CMPB PHP + Woo sub | catalogo Node + ledger |
| hash real do estado Stripe+local | hoje hash constante — **corrigir** |
| 409 se pagamento de edicao pendente | stub nao bloqueia |

## Testes minimos

- sem JWT → 401
- cancelada → 422 `subscription_not_editable`
- `edit_payment_pending` → 409
- termo 2 → 422
- dois previews do mesmo estado → mesmo `expected_current_hash`
- US devolve `next_cycle.tax` do preview Stripe (nao 10% fake)
- discount sempre ineligible
