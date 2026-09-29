# Ramo B — `order_first_checkout`

Parte da serie `POST .../subscription/checkout`.

- Identidade, auth, pipeline comum, contrato HTTP: [01-onboarding-subscription-checkout.md](./01-onboarding-subscription-checkout.md)
- Ramo A (`subscription_first`): [02-ramo-subscription-first.md](./02-ramo-subscription-first.md)
- Stripe, tax, webhook: [04-stripe-webhook-e-efeitos.md](./04-stripe-webhook-e-efeitos.md)

Default quando o body **nao** tem `checkout_mode`/`flow` = `subscription_first`. E o caminho do smoke (`artefatos/SMOKE_TEST_ONBOARDING_CHECKOUT.md`) e do Postman.

Objetivo: criar (ou reusar) um `WC_Order` pending com o snapshot da sessao e, **opcionalmente**, sincronizar Stripe no mesmo request se houver `pm_`. Flexible Subscription local **nao** e criada neste POST.

---

## 1) Reuso de pedido

Depois do save comum (desconto + fingerprint), o ramo B chama `get_existing_checkout_order`.

`should_reuse_checkout_order`:

- status Woo em `{ pending, failed, on-hold }`;
- meta `_hsr_checkout_context_fingerprint` presente e `hash_equals` com o fingerprint atual.

Se reusa:

1. `sync_reused_order_context` — corrige currency e billing email vazio (email do WP user vinculado).
2. `retry_stripe_sync_for_reused_order` — se ainda nao tem `sub_` **e** tem `pm_` na order meta, dispara de novo `hsr_checkout_order_ready_for_stripe_sync` (`flow: order_reuse_retry`).
3. `present_checkout(..., reused: true)` — HTTP 200, mesmo `order_id`.

Fingerprint **nao inclui** shipping, zipcode, tax, payment method nem pets alem de `id`+`name` (ver [01 §2.6](./01-onboarding-subscription-checkout.md)). Mudar frete **sem** mudar line items/prazo **reusa o pedido velho** (shipping antigo no Woo).

Se nao reusa: cria pedido novo. O anterior permanece `pending` orfao.

O save comum **antes** do fork ja zera `checkout_order_id` na sessao se o pedido nao for reusavel. `get_existing_checkout_order` le o id **depois** desse save — se zerou, nao reusa.

---

## 2) Precheck de promo e tax

Antes de criar o pedido:

1. `resolve_first_purchase_promotion_for_checkout` — se elegivel e slot `promo_` vazio → **503** (fail-closed). Inelegivel → segue sem desconto.
2. `ProductTaxService::resolve_from_session` — US + flag off + rates Woo vazias → **422** `sales_tax_unavailable` **antes** de criar o pedido.

---

## 3) Criacao do pedido Woo

1. `build_checkout_lines` a partir de `catalog_pricing.line_items` (`variation_id` preferido). Fallback legado: `payload.product_id` / `variation_id` / `quantity` — so se as lines da sessao estiverem vazias (o validate ja exige lines, entao o fallback quase nao dispara no caminho feliz).
2. `wc_create_order({ customer_id: linked_user_id })`. Falha → 500 `order_create_failed`.
3. `set_currency` se `resolve_order_currency` devolver USD/BRL.
4. `add_product` por line; se a line tem `line_total`, forca subtotal/total do item (`forcedLineTotals`).
5. `build_address` — zipcode da sessao + `payload.billing` (first/last/email/phone/company). `address_1` = street + `, ` + number se o number ainda nao estiver na street. Shipping = copia do billing.
6. Metas Eden: `_eden_delivery_instructions`, `_eden_phone_country` (do zipcode).
7. `_hsr_payment_method_id` se `pm_` no body.
8. `apply_selected_shipping` → `WC_Order_Item_Shipping` com cost/tax/label/method_id/instance_id do snapshot. Sem snapshot, nao adiciona item (o validate ja exigiu shipping se `needs_shipping()`).
9. `persist_shipping_projection_meta` — `_hsr_shipping_*` e `_hsr_product_tax*` (re-resolve tax; fallback no snapshot `product_tax` se o resolve falhar **neste ponto** — o precheck ja teria abortado US flag off).
10. Snapshot de onboarding em metas `_hsr_onboarding_*`, desconto, fingerprint, payload cru.
11. `calculate_totals`; se houve `line_total` forcado, **reescreve** `order.total` = lines + fees + shipping + shipping_tax + `_hsr_product_tax` (Woo tax nativo pode ser ignorado).
12. `_hsr_checkout_deferred_local_subscription = 1` — **nao** cria Flexible Subscription agora.
13. `_hsr_flexible_subscription_ids = []`, `_hsr_flexible_subscription_id = 0`.
14. `order->save()`.
15. `do_action('hsr_checkout_order_ready_for_stripe_sync', $order, { session_id, fingerprint, flow: 'order_first_checkout' })` — **sincrono no mesmo request**.
16. Grava `session.checkout_order_id`. Throw qualquer → 500 `checkout_failed` com `details` = exception message (pedido pode ter ficado pela metade).

### 3.1 Metas gravadas no pedido

Onboarding:

- `_hsr_onboarding_session_id`
- `_hsr_onboarding_pets`
- `_hsr_onboarding_questionnaire`
- `_hsr_onboarding_recurrence`
- `_hsr_onboarding_plan_selection`
- `_hsr_onboarding_zipcode`

Desconto:

- `_hsr_discount_eligibility`
- `_hsr_discount_applied_percent`
- `_hsr_stripe_discount_percent` / `_hsr_stripe_discount_duration` / `_hsr_stripe_discount_amount` (se percent > 0)
- `_hsr_stripe_promotion_code_id` (se promo resolvida)

Contexto / idempotencia (attempt e preenchido no sync, nao aqui):

- `_hsr_checkout_payload`
- `_hsr_checkout_context_fingerprint`
- `_hsr_checkout_context_snapshot_json`
- `_hsr_checkout_context_line_items_json`
- `_hsr_checkout_context_pets_json`
- `_hsr_checkout_context_total` (`discounted_first_month_total`)

Frete / tax:

- `_hsr_shipping_transit_business_days`
- `_hsr_shipping_delivery_days_min` / `_hsr_shipping_delivery_days_max`
- `_hsr_shipping_rate_id` / `_hsr_shipping_method_id` / `_hsr_shipping_label`
- `_hsr_shipping_cost` / `_hsr_shipping_tax_total` / `_hsr_shipping_currency`
- `_hsr_shipping_estimate_label`
- `_hsr_product_subtotal` / `_hsr_product_tax` / `_hsr_product_tax_percent`
- `_hsr_tax_jurisdiction` / `_hsr_tax_country`

Outros:

- `_hsr_payment_method_id`
- `_hsr_checkout_deferred_local_subscription`
- `_hsr_flexible_subscription_ids` / `_hsr_flexible_subscription_id`
- `_eden_delivery_instructions` / `_eden_phone_country`

---

## 4) `StripeCheckoutSync::sync_order`

Listener de `hsr_checkout_order_ready_for_stripe_sync` (`PawBowlStripe\StripeCheckoutSync`, priority 10).

Early-return **silencioso** (HTTP 200 do checkout mesmo assim):

- ja existe `_hsr_stripe_subscription_id`;
- nao ha `pm_` na order meta (prefixo `pm_`).

Erros viram meta `_hsr_stripe_sync_error` (string) e o checkout **ainda devolve 200** com `payment_state: sync_error`:

| Valor gravado | Quando |
|---|---|
| `missing_price_mapping` | nenhum line item mapeou `price_` (+ `_hsr_stripe_sync_debug` JSON) |
| `missing_billing_email` | email de billing vazio/invalido |
| `first_purchase_promo_not_configured` | percent > 0 e slot `promo_` vazio |
| message do `WP_Error` | `create_subscription` falhou |
| `missing_subscription_id_after_sync` | resultado sem `subscriptionId` |

Fluxo feliz do sync:

1. Resolve items a partir dos produtos do pedido (mesmo mapa `_stripe_price_ids_by_currency` / `_stripe_price_id`).
2. Garante `_hsr_attempt_id` estavel no pedido (`bin2hex(random_bytes(16))` se vazio) — retries do mesmo pedido reusam o attempt.
3. Resolve `promo_` da meta ou do prazo em `_hsr_onboarding_plan_selection`.
4. Chama `StripeSubscriptionService::create_subscription` **com `orderId`**.
5. Grava `_hsr_stripe_subscription_id`, `_hsr_stripe_client_secret`, PI id/status, customer id, idempotency/attempt.

Neste ramo lock/reuse/metas de order do servico Stripe funcionam de verdade (tem `orderId`). Detalhe das chamadas Stripe: [04](./04-stripe-webhook-e-efeitos.md).

Mapeamento Price no sync (`resolve_items_from_order`) e independente do HSR `resolve_checkout_items_from_session`. Lines sem mapa → `missing_price_mapping`, HTTP 200.

---

## 5) `present_checkout`

Monta o `data` do HTTP 200 a partir do pedido + sessao.

Campos extras vs ramo A:

- `order_id`, `order_key`, `status` Woo
- `payment_url` = `$order->get_checkout_payment_url()`
- `subscription_ids` = `wc_get_orders(type=fsb_subscription, parent=order_id)` (neste POST costuma ser `[]`)
- `stripe_*` lidos das metas (vazios se nao houve sync)
- `payment_state` via `resolve_payment_state` (tabela em [01 §3.5](./01-onboarding-subscription-checkout.md))
- `stripe_client_secret` zerado na **resposta** se `payment_state === paid`
- `checkout_trace_id` novo a cada response (log `hsr.present_checkout`)

`subtotal` / `product_tax` preferem metas `_hsr_product_subtotal` / `_hsr_product_tax`; fallback snapshot da sessao; fallback `order->get_subtotal()`.

---

## 6) Request / response (exemplos)

### 6.1 Sem `pm_` (smoke)

```http
POST /wp-json/custom/v1/onboarding/session/{session_id}/subscription/checkout
Content-Type: application/json
Authorization: Bearer {jwt}

{
  "billing": {
    "first_name": "Charles",
    "last_name": "Mendes",
    "email": "charles_test@example.com",
    "phone": "+5511999999999"
  }
}
```

```json
{
  "success": true,
  "data": {
    "session_id": "3abf4b2d-34f8-49f2-8d6e-6b9577beef00",
    "order_id": 4567,
    "order_key": "wc_order_abc123",
    "status": "pending",
    "total": 87.5,
    "subtotal": 79.0,
    "product_tax": 0.0,
    "shipping_total": 8.5,
    "shipping_tax": 0.0,
    "shipping_total_with_tax": 8.5,
    "currency": "BRL",
    "payment_url": "http://localhost:8080/checkout/order-pay/4567/?pay_for_order=true&key=wc_order_abc123",
    "subscription_ids": [],
    "flexible_subscription_id": 0,
    "stripe_subscription_id": "",
    "stripe_client_secret": "",
    "stripe_payment_intent_id": "",
    "stripe_payment_intent_status": "",
    "stripe_subscription_status": "",
    "stripe_sync_error": "",
    "stripe_sync_debug": [],
    "hsr_idempotency_key": "",
    "hsr_attempt_id": "",
    "checkout_trace_id": "6f1e2c90-....",
    "payment_state": "pending_payment_method",
    "has_payment_method": false,
    "reused": false
  }
}
```

### 6.2 Com `pm_` (sync no mesmo request)

Body adicional: `"payment_method_id": "pm_..."`.

`data` igual, porem:

- `stripe_subscription_id`, `stripe_client_secret`, `stripe_payment_intent_id` preenchidos;
- `payment_state`: `requires_confirmation` (tem client_secret) ou `sync_error` se o sync gravou `_hsr_stripe_sync_error`;
- `has_payment_method`: true.

Falha Stripe neste ramo **nao** muda o HTTP 200.

---

## 7) Depois deste POST

Flexible Subscription local: **nao** neste POST. `on_stripe_invoice_paid_confirmed` chama `do_action('woocommerce_rest_insert_shop_order_object', $order, null, true)` para o plugin Flexible criar `fsb_subscription`, depois `hsr_flexible_subscription_confirmed_after_payment` (propaga metas Stripe/shipping).

Ack: `POST .../payment-intent/ack` persiste PI nas **metas do pedido** (`checkout_order_id > 0`).

Webhook `invoice.paid`: se o pedido ja existe, so materializa Flexible (flag `_hsr_checkout_deferred_local_subscription === '1'`). Nao cria segundo pedido.
