# Fluxo Node — Stripe first

Parte da serie `POST /api/v1/onboarding/subscription/checkout`.

- Identidade, JWT, pipeline, contrato HTTP: [01-onboarding-subscription-checkout.md](./01-onboarding-subscription-checkout.md)
- O que **nao** portar do ramo WP `order_first`: [03-o-que-nao-portar-order-first.md](./03-o-que-nao-portar-order-first.md)
- Stripe, tax, webhook: [04-stripe-create-webhook-e-efeitos.md](./04-stripe-create-webhook-e-efeitos.md)

Este e o **unico** ramo no Node. Equivale ao PHP `CheckoutService::checkout_subscription_first`, sem sessao e sem Woo.

Objetivo: criar a Subscription Stripe **antes** de qualquer pedido local. A resposta devolve `order_id: 0` + `stripe_client_secret`. O ledger nasce `incomplete` neste POST. O status `active` so nasce no webhook `invoice.paid`.

Codigo vivo: `OnboardingSubscriptionCheckoutService.checkout` → `StripeBillingClient.createOnboardingSubscription`. Nao ha filter WP `hsr_checkout_create_stripe_subscription`; a chamada e direta.

---

## 1) Validacoes extras do fluxo

Rodam **depois** de `validateCheckoutState` e da revalidacao de desconto ([01 §2.3–2.5](./01-onboarding-subscription-checkout.md)).

| # | Regra | HTTP | `code` | Estado |
|---|---|---|---|---|
| 1 | `payment_method_id` / `paymentMethodId` vazio ou nao comeca com `pm_` | 422 | `invalid_payment_method` | **falta** (hoje o client aceita vazio) |
| 2 | nenhum Price mapeado a partir dos line items / pets | 422 | `invalid_price_id` | parcial: `items.length === 0` vira `session_incomplete` |
| 3 | email do `wp_users` vinculado invalido | 422 | `invalid_customer_email` | **falta** (hoje usa billing.email como fallback) |
| 4 | US + automatic tax sem `country`+`zipcode` | 422 | `sales_tax_unavailable` | **falta** (hoje so liga `automatic_tax` se country US) |
| 5 | promo 1a compra | 503 | `first_purchase_promo_not_configured` | implementado |
| 6 | `STRIPE_SECRET_KEY` ausente | 503 | `stripe_secret_missing` | implementado |

`extract_payment_method_id`: so aceitar string que comeca com `pm_`. Qualquer outro valor → 422. Fazer isso **antes** de chamar Stripe.

Email enviado a Stripe = `wp_users.user_email` do `userId` JWT. `payload.billing.email` so preenche buraco. Nome = `display_name` ou `billing.first_name + last_name`.

Endereco enviado a Stripe = coluna `address` (`street` / `zipcode` / `city` / `state` / `country`). Frete = coluna `shipping` (`cost`, `rate_id`, `method_id`, `label`).

---

## 2) Mapeamento Price

Fonte: `onboarding_user_state.plan_selection.catalog_pricing.line_items[]` (ja em `collectPriceItems`).

Para cada line:

1. `stripe_price_id` ou `price_id` se comecar com `price_`.
2. Senao `variation_id` → `wp_postmeta` `_stripe_price_ids_by_currency` na moeda do catalogo, fallback `_stripe_price_id`.
3. Fallback: `plan_selection.pets[].price_ids`.
4. Quantities do mesmo `price_` sao somadas (`Map`).

Alvo: line com `variation_id` e **sem** `price_` apos o lookup → 422 `unmapped_variant` (`details.variation_id`). **Nao** pular em silencio. Hoje `resolveSubscriptionItems` da `continue` nas lines sem `price_` — se todas cairem, o create estoura `session_incomplete`.

`priceId` no body: o front **nao** manda. Ignorar se mandar. Os `items[]` mapeados e que a Stripe assina.

---

## 3) Taxa de produto neste fluxo

Nao ha `ProductTaxService` / `WC_Tax`. Fonte de verdade US = Stripe.

| Pais / flag | Resultado no create |
|---|---|
| nao-US | sem `automatic_tax`, sem `tax_rates` |
| US + `STRIPE_US_AUTOMATIC_TAX=true` (default `.env.example`) | `automatic_tax.enabled=true`; exige `country`+`postal_code` |
| US + flag off | **nao** portar `txr_` Woo neste corte. Ou 422 `sales_tax_unavailable`, ou o mesmo Invoice Preview do `subscription/preview`. Um modo so. |

Subtotal de catalogo vem de `catalog_pricing.subtotal`. O `data.total` da resposta deve vir da invoice Stripe (`amount_due` / `total`), que ja inclui cupom `once` e tax.

Preview (`POST .../subscription/preview`) chama `invoices.createPreview` com automatic tax. Manter alinhado com o charge.

Detalhe Stripe: [04](./04-stripe-create-webhook-e-efeitos.md).

---

## 4) `StripeBillingClient.createOnboardingSubscription`

Substitui o filter WP. Entrada (sanitizada no service):

```js
{
  userId,
  email,                    // wp_users.user_email
  name,
  existingCustomerId,       // StripeCustomerStore.getCustomerId(userId)
  paymentMethodId,          // pm_...
  items: [{ price, quantity }],
  address,                  // coluna address
  shipping,                 // coluna shipping
  currency,                 // catalog_pricing.currency
  promotionCodeId,          // promo_... ou null
  subscriptionTermMonths,
  attemptId,                // alvo
  checkoutContextFingerprint // alvo
}
```

Nao enviar `orderId` Woo. Nao ha `source: headless_secure_registration`; metadata `source: eden_bowls_node` + `user_id` / `wp_user_id`.

Resposta interna (ja existe, ajustar `order_id`):

```json
{
  "customerId": "cus_...",
  "subscription": { "id": "sub_...", "status": "incomplete" },
  "checkout": {
    "order_id": 0,
    "stripe_subscription_id": "sub_...",
    "stripe_client_secret": "pi_..._secret_...",
    "stripe_payment_intent_id": "pi_...",
    "stripe_payment_intent_status": "requires_confirmation",
    "payment_state": "requires_confirmation",
    "has_payment_method": true,
    "reused": false,
    "total": 87.5,
    "subtotal": 79.0,
    "product_tax": 0.0,
    "shipping_total": 8.5
  }
}
```

O que a Stripe recebe e o lock/reuse: [04](./04-stripe-create-webhook-e-efeitos.md).

---

## 5) Persistencia apos o create

### 5.1 `onboarding_user_state.checkout_reference`

UPSERT por `user_id`. Shape alvo (snake_case):

```json
{
  "checkout_mode": "subscription_first",
  "order_id": 0,
  "status": "incomplete",
  "stripe_subscription_id": "sub_...",
  "stripe_customer_id": "cus_...",
  "stripe_client_secret": "pi_..._secret_...",
  "stripe_payment_intent_id": "pi_...",
  "stripe_payment_intent_status": "requires_confirmation",
  "stripe_subscription_status": "incomplete",
  "payment_state": "requires_confirmation",
  "has_payment_method": true,
  "reused": false,
  "currency": "USD",
  "subtotal": 79.0,
  "product_tax": 0.0,
  "total": 87.5,
  "shipping_total": 8.5,
  "attempt_id": "uuid-estavel",
  "checkout_context_fingerprint": "sha256...",
  "promotion_code_id": "promo_...",
  "discount_applied_percent": 25,
  "discount_duration": "once",
  "billing": { "first_name": "Charles", "last_name": "Mendes", "email": "...", "phone": "" }
}
```

Tambem regrava `plan_selection` se o `discounted_first_month_total` mudou.

Neste POST **nao** grava:

- pedido Woo
- Flexible Subscription
- `payment_state: paid` (isso e ACK otimista / webhook)

### 5.2 Ledger `stripe_subscriptions`

Ja acontece apos o create (`ledgerRepository.upsert`). Status = status Stripe (`incomplete`). Snapshots: pets, `plan_selection`, `shipping`, `address`, `subscription_term_months`.

O webhook `invoice.paid` promove para `active`. Sem esta linha, Meu Plano fica vazio e a 2a compra ainda pode ganhar cupom.

### 5.3 Customer

`StripeCustomerStore.saveCustomerId(userId, cus_)` em `wp_usermeta._hsr_stripe_customer_id`. Ja existe. Garantir que o **proximo** checkout leia isso **antes** de `customers.list({ email })`.

---

## 6) Resposta HTTP

Shape completo: [01 §3.3](./01-onboarding-subscription-checkout.md). Pontos deste fluxo:

| Campo | Valor |
|---|---|
| `order_id` | `0` |
| `order_key` | `""` ou `sub_{id}` (nao `Date.now()`) |
| `status` | `"incomplete"` (status Stripe) |
| `payment_url` | omitido / `""` |
| `subscription_ids` | `[]` |
| `flexible_subscription_id` | `0` |
| `payment_state` | `"requires_confirmation"` se houver client_secret |
| `has_payment_method` | `true` |
| `reused` | `true` so no early-return de idempotencia |

Front: `stripe.confirmCardPayment({ clientSecret })` → `POST /api/v1/onboarding/payment-intent/ack` (persiste PI no `checkout_reference`, sem pedido). Ver [../checkout/ROTA_ONBOARDING_PAYMENT_INTENT_ACK.md](../checkout/ROTA_ONBOARDING_PAYMENT_INTENT_ACK.md).

---

## 7) Materializacao tardia (nao e este POST)

No WP, `invoice.paid` criava `WC_Order`. No Node:

1. Lookup: ledger por `stripe_subscription_id`, senao `checkout_reference`, senao `cus_` no store, senao `metadata.user_id`.
2. UPSERT ledger `status = active` + periodos + last4.
3. UPDATE `checkout_reference.payment_state = paid`.
4. **Nao** criar pedido Woo.

Frete dos ciclos seguintes: webhook `invoice.created` (`subscription_cycle` + draft) + `invoiceItems.create`. O create deste POST **ja** grava `shipping_amount_minor` / `shipping_currency` / `shipping_product_id` na metadata quando `shipping.cost > 0`. Manter.

Detalhe: [04 § webhook](./04-stripe-create-webhook-e-efeitos.md) e [../other-routers/ROTA_STRIPE_WEBHOOK.md](../other-routers/ROTA_STRIPE_WEBHOOK.md).
