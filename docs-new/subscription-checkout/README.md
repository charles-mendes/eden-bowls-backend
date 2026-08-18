# Checkout de assinatura no backend Node

Guia de **implementacao** do Place Order (`POST /api/v1/onboarding/subscription/checkout`) e dos efeitos Stripe (create + webhook).

Origem WP (nao copiar): `docs/subscription-checkout/`.

Identidade: **JWT**. Nao ha `session_id`, `x-session-token`, `account-link` nem `linked_user_id`. O usuario e `request.currentUser.id`. Estado mora em `onboarding_user_state` (PK `user_id`) + ledger `stripe_subscriptions`.

Nao portar WooCommerce: sem `wc_create_order`, sem `payment_url` de pedido, sem `fsb_subscription`. Pedido local = `checkout_reference` + linha no ledger.

## Serie desta pasta

| Arquivo | Conteudo |
|---|---|
| [01-onboarding-subscription-checkout.md](./01-onboarding-subscription-checkout.md) | Identidade, JWT, pipeline, validacoes, desconto, contrato HTTP, erros, jornada |
| [02-fluxo-stripe-first.md](./02-fluxo-stripe-first.md) | Unico ramo Node: Stripe Subscription primeiro, `order_id` local 0, ledger `incomplete` |
| [03-o-que-nao-portar-order-first.md](./03-o-que-nao-portar-order-first.md) | Ramo WP `order_first` **nao entra**. O que reaproveitar (idempotencia) e o que descartar |
| [04-stripe-create-webhook-e-efeitos.md](./04-stripe-create-webhook-e-efeitos.md) | `createOnboardingSubscription`, tax, cupom, lock, webhook, persistencia, testes |

Rotas irmas (ja em `docs-new/`):

- ACK: [../checkout/ROTA_ONBOARDING_PAYMENT_INTENT_ACK.md](../checkout/ROTA_ONBOARDING_PAYMENT_INTENT_ACK.md)
- Preview imposto: [../checkout/ROTA_ONBOARDING_SUBSCRIPTION_PREVIEW.md](../checkout/ROTA_ONBOARDING_SUBSCRIPTION_PREVIEW.md)
- Cartoes: [../checkout/ROTA_ONBOARDING_PAYMENT_METHODS.md](../checkout/ROTA_ONBOARDING_PAYMENT_METHODS.md)
- Cupom 1a compra: [../coupons/STRIPE_COUPONS_FIRST_PURCHASE.md](../coupons/STRIPE_COUPONS_FIRST_PURCHASE.md)
- Webhook + dashboard: [../other-routers/ROTA_STRIPE_WEBHOOK.md](../other-routers/ROTA_STRIPE_WEBHOOK.md) e [../other-routers/APLICACAO_POS_CHECKOUT.md](../other-routers/APLICACAO_POS_CHECKOUT.md)

Contrato de tela: [../checkout/CHECKOUT_RULES.md](../checkout/CHECKOUT_RULES.md).

## Decisao de ramo

O PHP tinha **dois** ramos no mesmo path (`subscription_first` vs `order_first`). O front atual **nao** envia `checkout_mode`. Ele manda `payment_method_id` + `billing` e so segue Stripe se vier `stripe_client_secret`.

No Node ha **um** fluxo: o equivalente a `subscription_first`.

| WP | Node (alvo) |
|---|---|
| `checkout_mode: subscription_first` | unico caminho; ignorar `checkout_mode` / `flow` se vierem |
| `order_first` + `wc_create_order` | **nao portar** |
| `order_id: 0` ate o webhook | `order_id: 0`; webhook **nao** cria Woo, promove ledger |
| erro Stripe no ramo B = HTTP 200 + `sync_error` | **nao copiar**; falha Stripe = 4xx/5xx |

## O que ja existe vs o que falta

Codigo vivo hoje:

- `OnboardingSubscriptionCheckoutService` + rota JWT
- `validateCheckoutState` (pets, plan, address, shipping, recurrence)
- `StripeCouponService.resolveFirstPurchasePromotionForCheckout`
- `StripeBillingClient.createOnboardingSubscription` (`payment_behavior: default_incomplete`)
- UPSERT `checkout_reference` + `plan_selection`
- ledger `incomplete` no Place Order
- webhook `POST /stripe/v1/webhook` (`invoice.paid`, `invoice.created`, PI, subscription.*)

Falta fechar (esta serie):

1. Exigir `pm_` (422) — o front sempre manda; o client hoje aceita vazio.
2. Idempotencia (`attempt_id` persistido no `user_id` **ou** reuse da `sub_` `incomplete` da sessao de checkout).
3. Lock curto de create concorrente.
4. Nao gerar `order_id = Date.now()`.
5. Customer Stripe por `user_id` (`StripeCustomerStore`) **antes** de `customers.list(email)`.
6. Eligibility de compra previa **sem** contar checkout incompleto / Woo `pending` como compra.
7. Line sem `price_` → 422 `unmapped_variant` (nao pular em silencio ate zerar).
8. US + automatic tax sem ZIP → 422 `sales_tax_unavailable`.
9. Default `checkout_mode` no JSON gravado: `subscription_first` (hoje ainda cai em `order_first`).

Nao recriar:

- rotas `/onboarding/session/...`
- `account-link`
- `x-session-token`
- `wc_create_order` / Flexible Subscriptions como fonte de verdade
