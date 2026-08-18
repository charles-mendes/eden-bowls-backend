# Ramo A — `subscription_first`

Parte da serie `POST .../subscription/checkout`.

- Identidade, auth, pipeline comum, contrato HTTP: [01-onboarding-subscription-checkout.md](./01-onboarding-subscription-checkout.md)
- Ramo B (`order_first`): [03-ramo-order-first.md](./03-ramo-order-first.md)
- Stripe, tax, webhook: [04-stripe-webhook-e-efeitos.md](./04-stripe-webhook-e-efeitos.md)

Ativado por `"checkout_mode": "subscription_first"` (ou `"flow": "subscription_first"`). Handler: `CheckoutService::checkout_subscription_first`.

Objetivo: criar a Subscription Stripe **antes** do pedido Woo. A resposta devolve `order_id: 0` + `stripe_client_secret`. O `WC_Order` so nasce no webhook `invoice.paid` (`materialize_order_from_subscription_first`).

---

## 1) Validacoes extras do ramo

Rodam **depois** de `validate_session_for_checkout` e da revalidacao de desconto (ver [01 §2.3–2.5](./01-onboarding-subscription-checkout.md)).

| # | Regra | HTTP | `code` |
|---|---|---|---|
| 1 | `payment_method_id` / `paymentMethodId` vazio ou nao comeca com `pm_` | 422 | `invalid_payment_method` |
| 2 | nenhum Price mapeado a partir dos line items | 422 | `invalid_price_id` |
| 3 | `priceId`/`price_id` (ou fallback do 1o item) vazio / nao `price_` | 422 | `invalid_price_id` |
| 4 | email do WP user vinculado invalido | 422 | `invalid_customer_email` |
| 5 | `ProductTaxService::resolve_from_session` falhou (US, flag off, rates Woo vazias) | 422 | `sales_tax_unavailable` |
| 6 | promo 1a compra (secao 2.5 do 01) | 503 | `first_purchase_promo_not_configured` |
| 7 | filter retorna nao-array | 503 | `stripe_subscription_unavailable` |

`extract_payment_method_id`: so aceita string que comeca com `pm_`. Qualquer outro valor vira string vazia → 422.

`attempt_id`: do payload ou `wp_generate_uuid4()`. **Novo UUID a cada retry se o front nao reenviar o mesmo** — isso muda a Idempotency-Key Stripe (ver [04](./04-stripe-webhook-e-efeitos.md)).

Endereco enviado a Stripe = shipping da sessao (`zipcode`), com `address_1 = street + ", " + number` se o number ainda nao estiver na street (`build_address`). Billing first/last name vem do body (`payload.billing`); email vem do **WP user**, nao do body (o check de email usa `get_user_by('id', linked_user_id)->user_email`).

---

## 2) Mapeamento Price (`resolve_checkout_items_from_session`)

Fonte: `session.plan_selection.catalog_pricing.line_items[]`.

Para cada line:

1. Tenta `variation_id` depois `product_id` (candidatos Woo).
2. Le post meta `_stripe_price_ids_by_currency` (JSON `{ "usd": "price_...", "brl": "price_..." }`) na **moeda** da sessao:
   - `catalog_pricing.currency` se USD/BRL;
   - senao pais zipcode/session;
   - senao `get_woocommerce_currency()`.
3. Fallback: `_stripe_price_id` depois `stripe_price_id`.
4. Fallback: primeiro valor do mapa.
5. Lines sem `price_` sao **silenciosamente puladas**.
6. Quantities do mesmo `price_` sao somadas; resultado ordenado por `ksort` do price id.

Se **todas** as lines forem puladas → 422 `invalid_price_id` ("At least one mapped Stripe Price ID is required for checkout.").

`priceId` do body, se presente e comecar com `price_`, e enviado ao filter como `priceId` (primary). Os `items[]` mapeados e que a Stripe de fato assina. Se o body omitir `priceId`, usa `items[0].price`.

---

## 3) Taxa de produto neste ramo

`ProductTaxService::resolve_from_session($session)` **recalcula** (nao reusa cegamente `plan_selection.product_tax`):

| Pais / flag | Resultado |
|---|---|
| nao-US | `product_tax=0`, `product_tax_percent=0`, jurisdiction vazia |
| US + `STRIPE_US_AUTOMATIC_TAX` on | placeholder `product_tax=0`; jurisdiction = state. Imposto real na invoice Stripe |
| US + flag off | `WC_Tax::find_rates` + `calc_exclusive_tax`. Rates vazias / percent 0 / amount 0 → 422 `sales_tax_unavailable` |

Subtotal vem de `catalog_pricing.subtotal` (fallback `product_tax.subtotal`).

O percentual/amount resolvido entra no payload do filter (`tax_country`, `tax_jurisdiction`, `product_tax_percent`, `product_tax`) e no `session.stripe_checkout` persistido.

Detalhe Stripe (automatic_tax vs `txr_` manuais): [04](./04-stripe-webhook-e-efeitos.md).

---

## 4) Filter `hsr_checkout_create_stripe_subscription`

HSR monta o payload e chama:

```php
$result = apply_filters('hsr_checkout_create_stripe_subscription', null, $filterPayload);
```

`PawBowlStripe\Plugin` registra o unico listener (priority 10, 2 args) e encaminha para `StripeSubscriptionService::create_subscription`. Sem o plugin billing, `$result` continua `null` → 503 `stripe_subscription_unavailable`.

Se o listener devolver `WP_Error`, o checkout devolve esse erro (HTTP 4xx/5xx do servico Stripe).

Payload do filter (campos sanitizados de novo no listener; `source` e injetado pelo billing, nao pelo HSR):

```json
{
  "customerEmail": "user@example.com",
  "customerName": "Charles Mendes",
  "paymentMethodId": "pm_...",
  "items": [{ "price": "price_...", "quantity": 2 }],
  "priceId": "price_...",
  "sessionId": "3abf4b2d-...",
  "attempt_id": "uuid",
  "checkout_context_fingerprint": "sha256...",
  "shipping_rate_id": "...",
  "shipping_method_id": "...",
  "shipping_label": "UPS Ground",
  "shipping_cost": 8.5,
  "shipping_tax_total": 0.68,
  "shipping_currency": "USD",
  "tax_country": "US",
  "tax_jurisdiction": "NY",
  "product_tax_percent": 8.875,
  "product_tax": 7.01,
  "customer_address": {
    "line1": "350 5th Avenue, 100",
    "line2": "",
    "city": "New York",
    "state": "NY",
    "postal_code": "10001",
    "country": "US"
  },
  "checkout_mode": "subscription_first",
  "source": "headless_secure_registration",
  "promotion_code_id": "promo_...",
  "discount_percent": 25,
  "discount_coupon_id": "",
  "discount_duration": "once"
}
```

Campos de promo so entram se `resolve_first_purchase_promotion_for_checkout` retornou array. `orderId` **nao** e enviado (fica 0 no servico).

Frete no payload vem do snapshot `plan_selection.shipping` (rate_id, method_id, label, cost, tax_total). Moeda = `resolve_order_currency`.

O que a Stripe recebe e o lock/reuse: [04](./04-stripe-webhook-e-efeitos.md).

Resposta interna esperada do filter (nao e o envelope HTTP):

```json
{
  "clientSecret": "pi_..._secret_...",
  "subscriptionId": "sub_...",
  "customerId": "cus_...",
  "status": "incomplete",
  "paymentIntentId": "pi_...",
  "paymentIntentStatus": "requires_confirmation",
  "current_period_end": 0,
  "orderId": 0,
  "hsr_idempotency_key": "hsr-sub-create-...",
  "hsr_attempt_id": "uuid",
  "reused": false
}
```

(`reused` so no early-return do servico Stripe.)

---

## 5) Persistencia apos o filter

`session.stripe_checkout` gravado em `stripe_checkout_json` via `repository->save`:

```json
{
  "checkout_mode": "subscription_first",
  "stripe_subscription_id": "sub_...",
  "stripe_client_secret": "pi_..._secret_...",
  "stripe_payment_intent_id": "pi_...",
  "stripe_payment_intent_status": "requires_confirmation",
  "stripe_subscription_status": "incomplete",
  "hsr_idempotency_key": "...",
  "hsr_attempt_id": "...",
  "currency": "USD",
  "subtotal": 79.0,
  "product_tax": 0.0,
  "product_tax_percent": 0.0,
  "tax_jurisdiction": "NY",
  "total": 87.5,
  "payment_state": "requires_confirmation",
  "promotion_code_id": "promo_...",
  "discount_percent": 25,
  "discount_duration": "once"
}
```

`total` HSR = `productSubtotal + productTax + shippingCost + shippingTaxTotal` — **nao** e o `invoice.total` da Stripe.

Neste POST **nao** grava:

- `checkout_order_id` (permanece null/0)
- pedido Woo
- Flexible Subscription (`fsb_subscription`)

Billing tambem grava no mesmo `create_subscription`:

- ledger `{prefix}hsr_stripe_subscriptions` (+ enrichment);
- option `hsr_stripe_subscription_order_map` (order_id pode ser 0);
- option `hsr_idempotency_audit` (cap 5000, trim 2000);
- metas de order **so** se `resolvedOrderId > 0` (neste ramo, em geral nao).

---

## 6) Resposta HTTP

Shape completo: [01 §3.3](./01-onboarding-subscription-checkout.md). Pontos do ramo A:

| Campo | Valor |
|---|---|
| `order_id` | `0` |
| `order_key` | `""` |
| `status` | `"pending"` |
| `payment_url` | `""` |
| `subscription_ids` | `[]` |
| `flexible_subscription_id` | `0` |
| `stripe_sync_error` | `""` |
| `stripe_sync_debug` | `[]` |
| `payment_state` | `"requires_confirmation"` (forcado) |
| `has_payment_method` | `true` |
| `reused` | `!empty($result['reused'])` |

Front: `stripe.confirmPayment({ clientSecret })` → `POST .../payment-intent/ack` (persiste em `session.stripe_checkout`, sem pedido). Ver [../payment-intent-ack/01-onboarding-payment-intent-ack.md](../payment-intent-ack/01-onboarding-payment-intent-ack.md).

---

## 7) Materializacao tardia (nao e este POST)

Pedido Woo nasce em `CheckoutService::on_stripe_invoice_paid_confirmed` quando o webhook dispara `hsr_stripe_invoice_paid_confirmed` com `orderId=0`.

Lookup da sessao: `OnboardingRepository::find_by_stripe_subscription_id` — `stripe_checkout_json LIKE '%"stripe_subscription_id":"sub_..."%'`.

Depois:

1. `wc_create_order` com as mesmas lines/endereco/shipping do snapshot;
2. metas `_hsr_*` + `_hsr_stripe_subscription_id`;
3. `payment_complete(pi_...)`;
4. `session.checkout_order_id = order.id`;
5. `woocommerce_rest_insert_shop_order_object` para o plugin Flexible criar `fsb_subscription`;
6. `hsr_flexible_subscription_confirmed_after_payment`.

Detalhe: [04 § webhook](./04-stripe-webhook-e-efeitos.md).
