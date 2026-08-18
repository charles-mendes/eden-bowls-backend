# Rota: preview de edicao da assinatura

## Escopo

Rota atual no backend Node (stub):

- `POST /api/v1/subscriptions/:subscriptionId/edit/preview`

Front:

- `previewSubscriptionEdit` em `subscriptionEditApi.ts`
- `EditSubscription.tsx` (`runPreview` → passo review)

Arquivos atuais:

- `src/api/routes/subscriptions-edit-preview.routes.js`
- `src/services/subscriptions-edit-preview.service.js` — so JWT + regex `sub_`
- `src/infrastructure/repositories/subscriptions-edit-preview.repository.js` — `expected_current_hash: 'hash-123'`, prorrata `none`, next_cycle `30 USD`, discount sempre inelegivel
- `tests/subscriptions-edit-preview.routes.test.js`

Rota legado WordPress:

- `POST /custom/v1/subscriptions/:subscriptionId/edit/preview`

Nao confundir com `POST /api/v1/onboarding/subscription/preview` (imposto US do checkout) nem `POST /api/v1/onboarding/plan/preview` (catalogo da tela Plan). O edit **reusa o catalogo** do plan preview.

## Responsabilidade

Simular a edicao **sem persistir**. Devolve estado atual, estado proposto, hash de consistencia, prorrata e totais do proximo ciclo.

O commit posterior **exige** `expected_current_hash` desta resposta. Preview e commit sao um par. Se o preview continuar gerando `hash-123` fixo, qualquer commit aceita estado stale.

## Estado de implementacao

| Parte | Status |
|---|---|
| JWT + `sub_` | implementado |
| Stripe / catalogo / ownership | **nao** |
| `edit_payment_pending` | stub nao bloqueia |
| Hash | constante `'hash-123'` |
| Discount 1a compra | stub ja devolve inelegivel (manter) |

O service **nao** chama `assertCriticalOperationAllowed` (o WP rate-limitava 40/300s). Alvo: JWT basta na preview (read-only). Commit e que cobra.

## Auth

```http
POST /api/v1/subscriptions/sub_123/edit/preview
Authorization: Bearer <jwt>
Content-Type: application/json
```

## Validacoes a portar

| Regra | Erro |
|---|---|
| Usuario logado | 401 `unauthorized` |
| `sub_` valido | 422 `invalid_subscription_id` |
| Ownership | 404 `subscription_not_found` |
| Assinatura cancelada | 422 `subscription_not_editable` |
| `edit_payment_pending` no ledger | 409 `edit_payment_pending` |
| `subscription_term_months` ∈ {1, 3, 6} | 422 `invalid_subscription_term` |
| Pet enabled sem sabor / peso > 0 | 422 `invalid_plan` |
| Catalogo nao resolve price | 422 `catalog_pricing_unavailable` |
| Pet ja em outra sub ativa do mesmo user | 422 `pet_blocked` |
| Lista Stripe / items vazia | 422 `invalid_plan` |

Reusar validacao de pets/termo de `OnboardingPlanPreviewService` (`ALLOWED_SUBSCRIPTION_TERMS`, `validatePreviewPayload`). Extrair para `src/core/` se precisar compartilhar sem puxar quotes.

O front trata `edit_payment_pending` com copy de "update your card or cancel".

## Fluxo alvo

1. Carrega ledger do user + `assert_editable`.
2. Resolve plano proposto (termo + pets + sabores + pack) via **mesmo catalogo** de `POST /api/v1/onboarding/plan/preview` (`OnboardingPlanPreviewRepository` / `buildPlanPreviewResponse`).
3. `subscriptions.retrieve` com expand de items/price (novo metodo no `StripeBillingClient`).
4. `buildCurrentHash` do estado **atual** (items Stripe + termo ledger + address + shipping) — `src/core/subscription-edit-hash.js`. Algoritmo: canonicalize (chaves ordenadas, como `onboarding-plan-preview.service.js`) + sha256 hex. Preview e commit **tem de importar o mesmo modulo**.
5. `previewProration` Stripe (`invoices.createPreview` com `subscription` + items propostos, ou `subscription_details` + proration). Mapear para `direction`: `charge` (amount_due > 0) / `credit` ( < 0) / `none`.
6. Se address US: reusar `previewSubscriptionInvoice` (tax automatico) para `next_cycle`.
7. BR: next_cycle sem tax Stripe; shipping do snapshot proposto.
8. Discount **sempre** `{ eligible: false, reason: edit_no_first_purchase_promo, percent: 0 }`. Cupom de 1a compra **nao** vale em edicao.

Nao grava `edit_pending`. Isso e o commit.

## Request

Contrato TS `SubscriptionEditPayload` (`expected_current_hash` opcional na preview — a UI usa o da **resposta** no commit):

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

`payment_method_id` entra na projecao; o attach real e `/actions` + commit.

Validator compartilhado: `src/api/validators/subscriptions-edit.validator.js` (Zod). Preview e commit usam o mesmo parse; commit exige `expected_current_hash`.

## Response

Contrato TS `SubscriptionEditPreviewResponse`:

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

`term_change` altera a logica de prorrata — nao e so um flag de UI (comparar termo atual do ledger vs body).

## Regras a preservar

1. Preview e read-only.
2. Hash e a trava de concorrencia do commit (`409 subscription_state_changed`).
3. Edicao nunca reaplicia promo de 1a compra.
4. `edit_payment_pending` bloqueia **antes** de calcular.
5. Pais muda catalogo e tax (US invoice preview).

## Persistencia

Nenhuma nesta rota. Le ledger / catalogo / Stripe.

## Wiring

`src/index.js` hoje: `new SubscriptionsEditPreviewRepository()`. Alvo: injetar ledger, `stripeBilling`, `onboardingPlanPreviewRepository` (ou products + recommendation, o mesmo grafo do plan preview).

## Testes minimos

- sem JWT → 401 (ja existe)
- cancelada → 422 `subscription_not_editable`
- `edit_payment_pending` → 409
- termo 2 → 422
- dois previews do mesmo estado → mesmo `expected_current_hash`
- US devolve `next_cycle.tax` do preview Stripe (nao constante 0/10%)
- discount sempre ineligible
- sub de outro user → 404
