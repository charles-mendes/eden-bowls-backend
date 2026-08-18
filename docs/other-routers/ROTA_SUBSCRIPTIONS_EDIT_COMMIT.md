# Rota: commit de edicao da assinatura

## Escopo

Rota legado WordPress:

- `POST /custom/v1/subscriptions/:subscriptionId/edit/commit`

Rota Node:

- `POST /api/v1/subscriptions/:subscriptionId/edit/commit`

**Nao existe no Express.** O front ja chama (`commitSubscriptionEdit` em `subscriptionEditApi.ts`, `runCommit` em `EditSubscription.tsx`) e toma 404.

Nao ha `ANALISE_MIGRACAO_*` so deste path. O contrato abaixo sai do PHP `StripeSubscriptionEditService` (mesmo plugin do preview), do shape TS do front e das metas `_hsr_edit_*` documentadas no preview.

## Responsabilidade

Aplicar a edicao que a preview simulou: atualizar items/termo/endereco/shipping na Stripe, cobrar prorrata se `direction = charge`, marcar pendencia se o PI precisar de 3DS.

Nao e `/actions`. Pause/cancel ficam em actions. Troca de plano, prazo, pets e endereco passam por **preview → commit**.

## Auth

JWT obrigatorio. Mesma conta ativa que checkout/ACK (`assertCriticalOperationAllowed` se a edicao cobra). Rate no WP: mesmo bucket do preview (40 / 300s).

## Par com a preview

```
preview → expected_current_hash
commit  → body inclui o hash
          backend recomputa hash do estado atual
          diverge → 409 subscription_state_changed
          (EditSubscription re-roda preview)
```

Sem hash no body → 422 `expected_current_hash_required` (WP).

## Validacoes (iguais a preview + extras)

Tudo que a preview bloqueia, o commit bloqueia de novo (nao confiar so no client):

- cancelada → 422 `subscription_not_editable`
- `edit_payment_pending` → 409
- termo 1 \| 3 \| 6
- plano/catalogo/pet_blocked
- hash obrigatorio e fresco

Se a preview gerou charge e o commit nao receber `payment_method_id` (nem um default na sub) → 422 `invalid_payment_method`.

## Fluxo WP

1. `assert_editable` + recompute hash.
2. Resolve plano proposto (mesmo `resolve_proposed_plan` da preview).
3. Atualiza Subscription Stripe (items, price, metadata de termo/shipping/address).
4. Se prorrata `charge`: cria/finaliza invoice; se o PI vier `requires_confirmation`, grava:
   - `_hsr_edit_payment_pending = 1`
   - `_hsr_edit_pending_plan_selection` / `_hsr_edit_pending_term_months` / `_hsr_edit_pending_shipping`
   - `_hsr_edit_pending_invoice_id`
   - devolve `stripe_client_secret` + `payment_state: requires_confirmation`
5. Se `credit` / `none`: aplica ja; `edit_payment_pending` permanece false; `pending_webhook_confirmation` pode ser true ate `customer.subscription.updated`.
6. Nao reaplicia cupom de 1a compra.

O front, se `stripe_client_secret` e `payment_state === requires_confirmation`, chama `confirmCardPayment` (mesmo padrao do Place Order). **Nao** chama ACK de onboarding depois do edit; a convergencia e o webhook.

Se o usuario trocou cartao, o Edit chama `update_payment_method` **antes** deste POST.

## Fluxo alvo Node

```mermaid
sequenceDiagram
    participant Front
    participant PREV as POST .../edit/preview
    participant CMT as POST .../edit/commit
    participant Stripe
    participant WH as webhook

    Front->>PREV: payload
    PREV-->>Front: expected_current_hash + proration
    opt cartao novo
        Front->>Front: POST .../actions update_payment_method
    end
    Front->>CMT: payload + hash
    CMT->>CMT: recompute hash
    alt stale
        CMT-->>Front: 409 subscription_state_changed
    end
    CMT->>Stripe: subscriptions.update
    alt proration charge + PI
        CMT-->>Front: client_secret requires_confirmation
        Front->>Stripe: confirmCardPayment
    end
    Stripe->>WH: invoice.paid / customer.subscription.updated
    WH->>WH: ledger + limpa edit_payment_pending
```

## Request

Mesmo body da preview **mais** `expected_current_hash`:

```json
{
  "subscription_term_months": 3,
  "pets": [{ "pet_name": "Milo", "enabled": true, "selected_flavors": ["chicken"], "flavor_weights": [100] }],
  "address": { "country": "US", "state": "CA", "postal_code": "94105" },
  "shipping": { "method_id": "ship_1", "label": "FedEx", "cost": 12.9, "total": 12.9 },
  "payment_method_id": "pm_123",
  "expected_current_hash": "sha256-..."
}
```

## Response (contrato TS `SubscriptionEditCommitResponse`)

```json
{
  "success": true,
  "data": {
    "subscription_id": "sub_123",
    "pending_webhook_confirmation": true,
    "term_change": true,
    "proration": {
      "direction": "charge",
      "amount_due_now": 12.5,
      "credit_applied": 0,
      "currency": "USD"
    },
    "payment_state": "requires_confirmation",
    "stripe_invoice_id": "in_...",
    "stripe_payment_intent_id": "pi_...",
    "stripe_client_secret": "pi_..._secret_...",
    "stripe_payment_intent_status": "requires_confirmation",
    "edit_payment_pending": true
  }
}
```

`payment_state` alinhado ao checkout: `paid` | `requires_confirmation` | `failed` | `pending_payment_method`.

Quando nao ha cobranca imediata:

- `stripe_client_secret`: `null`
- `edit_payment_pending`: `false`
- `payment_state`: `paid` (nada a confirmar) ou omitir charge
- o front **nao** entra no `confirmCardPayment` (`EditSubscription.tsx` so confirma se secret **e** `requires_confirmation`)

Depois do sucesso o front mostra toast e navega para `/dashboard/plans/:id`.

## Relacao com webhook

| Evento | Efeito no edit |
|---|---|
| `invoice.paid` da invoice de prorrata | limpar `edit_payment_pending`; gravar plan_selection novo no ledger |
| `invoice.payment_failed` | manter pendencia; `payment_state` failed no detalhe |
| `customer.subscription.updated` | items/termo do ledger = Stripe |

Enquanto `edit_payment_pending`, preview e commit seguintes → 409. O usuario so sai dali atualizando cartao (`/actions`) ou cancelando.

## Persistencia WP (metas a traduzir)

- `_hsr_edit_payment_pending`
- `_hsr_edit_pending_plan_selection`
- `_hsr_edit_pending_term_months`
- `_hsr_edit_pending_shipping`
- `_hsr_edit_pending_invoice_id`
- `_hsr_edit_preimage` (hash)

Node: colunas/JSON no ledger, nao postmeta Woo.

## Arquivos Node a criar

```text
src/api/routes/subscriptions-edit-commit.routes.js
src/services/subscriptions-edit-commit.service.js
src/infrastructure/repositories/subscriptions-edit-commit.repository.js
src/api/validators/subscriptions-edit.validator.js   # compartilhado com preview
tests/subscriptions-edit-commit.routes.test.js
```

Registrar em `src/app.js` / `src/index.js` **junto** com o preview. Preview sem commit deixa a tela de review sem save.

## O que mudou em relacao ao WordPress

| Antes (WP) | Alvo (Node) |
|---|---|
| commit no plugin billing + metas Woo | rota Express nova + ledger |
| Flexible/order atualizados no webhook | so ledger |
| front ja aponta para `/api/v1/.../edit/commit` | hoje 404 |

## Testes minimos

- rota ausente hoje → 404 (este teste some quando a rota existir)
- sem JWT → 401
- sem `expected_current_hash` → 422
- hash stale → 409; segundo commit com hash novo da preview → 200
- prorrata `none` → sem `stripe_client_secret`, `edit_payment_pending` false
- prorrata `charge` com PI incomplete → secret + `requires_confirmation` + pending true
- nao aplica promo de 1a compra
- commit de sub de outro user → 404
