# O que nao portar — ramo WP `order_first`

Parte da serie `POST /api/v1/onboarding/subscription/checkout`.

- Identidade / contrato: [01-onboarding-subscription-checkout.md](./01-onboarding-subscription-checkout.md)
- Unico fluxo Node: [02-fluxo-stripe-first.md](./02-fluxo-stripe-first.md)
- Stripe + webhook: [04-stripe-create-webhook-e-efeitos.md](./04-stripe-create-webhook-e-efeitos.md)

Origem WP: `docs/subscription-checkout/03-ramo-order-first.md`.

No PHP este era o **default** (body sem `checkout_mode`): criava `WC_Order` pending, opcionalmente sincronizava Stripe no mesmo request se viesse `pm_`, e engolia erro Stripe em HTTP 200.

No Node **nao entra**. O front atual (`Checkout.tsx`) nunca manda `checkout_mode` e sempre manda `payment_method_id`. Ele so confirma cartao se a resposta tiver `stripe_client_secret`. Um ramo Woo sem secret deixa o Place Order mudo.

Este arquivo lista o que descartar e o que reaproveitar (idempotencia / reuse) no fluxo Stripe-first.

---

## 1) Por que o ramo B nao existe no Node

| Comportamento WP | Decisao Node |
|---|---|
| Default quando `checkout_mode` ausente | Stripe-first. Ignorar o campo |
| `wc_create_order` + line items + shipping item | **nao portar** |
| `payment_url` = `$order->get_checkout_payment_url()` | **nao devolver** |
| Reuso de pedido Woo por fingerprint | reuso de **Subscription** `incomplete` (ver §3) |
| Sync Stripe opcional se `pm_` | create Stripe e **obrigatorio** |
| Falha Stripe → HTTP 200 + `payment_state: sync_error` | **nao copiar**; 502/422 |
| `_hsr_checkout_deferred_local_subscription` + Flexible | ledger `incomplete` + webhook `active` |
| Metas `_hsr_*` no post Woo | JSON `checkout_reference` + colunas do ledger |
| `product_id` / `variation_id` / `quantity` no body | **nao aceitar**; snapshot do `user_id` |
| Smoke/Postman sem `pm_` | o front exige `pm_`; sem ele → 422 |

O stub antigo do Node (`order_first` **sem** `stripe_client_secret`, totais `29.99`) ja foi substituido por `createOnboardingSubscription`. Residual a limpar: default `checkout_mode = 'order_first'` no service e `order_id = Date.now()`.

---

## 2) Mapa das metas Woo → persistencia Node

Nao criar tabela de pedido. O que o PHP gravava em `_hsr_*` cabe em dois JSON + ledger.

| Meta WP no pedido | Onde no Node |
|---|---|
| `_hsr_onboarding_session_id` | **nao existe** (`user_id`) |
| `_hsr_onboarding_pets` | `onboarding_pets` + `stripe_subscriptions.pets_snapshot` |
| `_hsr_onboarding_plan_selection` | `onboarding_user_state.plan_selection` + ledger |
| `_hsr_onboarding_zipcode` | `onboarding_user_state.address` |
| `_hsr_onboarding_questionnaire` / `_hsr_onboarding_recurrence` | recurrence na coluna; questionnaire nao persiste |
| `_hsr_discount_*` / `_hsr_stripe_promotion_code_id` | `checkout_reference` + `plan_selection.catalog_pricing` |
| `_hsr_checkout_context_fingerprint` | `checkout_reference.checkout_context_fingerprint` (alvo) |
| `_hsr_attempt_id` | `checkout_reference.attempt_id` (alvo) |
| `_hsr_shipping_*` / `_hsr_product_tax*` | coluna `shipping` + invoice Stripe; tax nao e Woo |
| `_hsr_payment_method_id` | so no create; nao precisa meta de pedido |
| `_hsr_stripe_subscription_id` / client_secret / PI | `checkout_reference` |
| `_hsr_stripe_sync_error` | **nao usar** como sucesso 200 |
| `_hsr_checkout_deferred_local_subscription` | ledger `incomplete` |
| `_hsr_flexible_subscription_id(s)` | **nao portar** |
| `_eden_delivery_instructions` / `_eden_phone_country` | ja podem viver em `address` / `shipping` se o front mandar; nao bloquear checkout |

---

## 3) Reuso — o que copiar da ideia, nao do Woo

O PHP reusava o `WC_Order` se:

- status em `{ pending, failed, on-hold }`;
- fingerprint da meta batia.

Buraco: fingerprint **nao** incluia shipping/CEP/tax/`pm_`. Mudar frete reusava pedido velho.

No Node, reuse = Subscription Stripe `incomplete` do **mesmo** `user_id`.

`should_reuse_checkout` alvo:

1. `checkout_reference.stripe_subscription_id` comeca com `sub_`.
2. Status Stripe ou local em `{ incomplete, incomplete_expired? }` — **nao** reusar `active` / `trialing` / `canceled`.
3. Fingerprint atual `hash_equals` o gravado (fingerprint **completo**, ver [01 §2.6](./01-onboarding-subscription-checkout.md)).
4. PaymentIntent ainda utilizavel (`requires_confirmation` / `requires_action`) **ou** retrieve na Stripe para reconciliar.

Se reusa:

1. Opcional: `paymentIntents.retrieve` para atualizar status.
2. HTTP 200, mesmo `stripe_subscription_id` e `client_secret`, `"reused": true`.
3. **Nao** chamar `subscriptions.create` de novo.

Se o fingerprint mudou: nao reusar. Cancelar ou deixar expirar a `sub_` antiga (nao e obrigatorio neste corte). Criar nova. A anterior `incomplete` nao conta como compra para eligibility.

Se nao ha `sub_` persistida: create normal.

Nao reusar por `order_id` Woo. Nao reusar so porque `payment_method_id` e o mesmo.

---

## 4) `present_checkout`

O PHP montava `data` a partir do pedido Woo (`order_key`, `payment_url`, status, Flexible ids).

No Node a fonte e o objeto `checkout` devolvido por `createOnboardingSubscription` + campos de desconto do service.

Nao ler:

- `wc_get_orders(type=fsb_subscription)`
- `get_checkout_payment_url()`
- metas `_hsr_product_subtotal`

`checkout_trace_id`: opcional (UUID por response, so log). Nao persistir. Nao e contrato do front.

Quando `payment_state === paid`, omitir `stripe_client_secret` na **resposta**.

---

## 5) Request / response que o smoke WP usava — nao implementar

O PHP aceitava Place Order **sem** `pm_`:

```json
{
  "billing": { "first_name": "Charles", "last_name": "Mendes", "email": "..." }
}
```

Resposta com `order_id > 0`, `payment_url` Woo, `payment_state: pending_payment_method`.

No Node isso e **422** `invalid_payment_method`. O teste de rota deve cobrir isso; nao ha caminho feliz sem cartao.

Segundo POST identico: no WP devolvia `"reused": true` com o mesmo `order_id`. No Node, `"reused": true` com o mesmo `stripe_subscription_id` (secao 3).

Com `pm_` no ramo B, falha Stripe **nao** mudava o HTTP 200. No Node, falha Stripe **muda** o status (502/422). Nao ha `stripe_sync_error` de sucesso.

---

## 6) Depois deste POST (WP vs Node)

| WP | Node |
|---|---|
| Flexible criada no `invoice.paid` via `woocommerce_rest_insert_shop_order_object` | ledger `active` no mesmo evento |
| ACK grava metas do **pedido** se `order_id > 0` | ACK grava `checkout_reference` do `user_id` |
| `invoice.paid` com pedido ja existente so materializa Flexible | `invoice.paid` e idempotente no ledger; nao cria segundo registro |

Nao implementar `on_stripe_invoice_paid_confirmed` que chama Woo hooks.
