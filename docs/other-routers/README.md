# Pos-checkout: rotas ainda nao convertidas

Documentacao do que o WordPress faz **depois** do Place Order, e o que o Node precisa portar.

Checkout, ACK, frete, lookup, cartoes e preview Stripe ja estao em [docs-new/checkout](../docs-new/checkout/). Este diretorio cobre o bloco seguinte: **webhook + dashboard de assinatura**.

Fonte WP (codigo vivo):

- `pawbowl-wp/wp/wp-content/plugins/pawbowl-stripe-billing/`
- `pawbowl-wp/wp/wp-content/plugins/headless-secure-registration/` (`CheckoutService::on_stripe_invoice_paid_confirmed`)

Analises WP longas: `docs/rotes/ANALISE_MIGRACAO_ROTA_SUBSCRIPTIONS*.md` e `docs/checkout/`. Este diretorio e o guia de transicao, no mesmo papel de [docs-new/checkout/APLICACAO_CHECKOUT.md](../docs-new/checkout/APLICACAO_CHECKOUT.md).

Identidade no Node: **JWT**. Sem `session_id`. Sem Woo `fsb_subscription`. Persistencia alvo: ledger por `user_id` + `checkout_reference` ja gravado no Place Order.

## O que ja entrou no Node (fora deste diretorio)

| Responsabilidade | Estado |
|---|---|
| Place Order Stripe | `POST /api/v1/onboarding/subscription/checkout` — cria Subscription, devolve `stripe_client_secret` |
| ACK do PaymentIntent | `POST /api/v1/onboarding/payment-intent/ack` — persiste status; **nao** confirma cobranca |
| Customer Stripe | `wp_usermeta._hsr_stripe_customer_id` via `StripeCustomerStore` |
| Frete 1a invoice | checkout injeta via `add_invoice_items` / `STRIPE_SHIPPING_PRODUCT_ID` |

## O que falta converter

| WP (hoje) | Node (hoje) | Documento |
|---|---|---|
| `POST /custom/v1/stripe-webhook` (`invoice.paid`, `invoice.created`, `payment_intent.*`, `customer.subscription.*`) | **nao existe** | [ROTA_STRIPE_WEBHOOK.md](./ROTA_STRIPE_WEBHOOK.md) |
| `GET /custom/v1/subscriptions` | rota existe, stub `[]` | [ROTA_SUBSCRIPTIONS.md](./ROTA_SUBSCRIPTIONS.md) |
| `GET /custom/v1/subscriptions/:id/detail` | rota existe, stub Premium/Milo | [ROTA_SUBSCRIPTIONS_DETAIL.md](./ROTA_SUBSCRIPTIONS_DETAIL.md) |
| `POST /custom/v1/subscriptions/:id/actions` | rota existe, stub `pending_webhook_confirmation` | [ROTA_SUBSCRIPTIONS_ACTIONS.md](./ROTA_SUBSCRIPTIONS_ACTIONS.md) |
| `POST /custom/v1/subscriptions/:id/edit/preview` | rota existe, stub totais fixos | [ROTA_SUBSCRIPTIONS_EDIT_PREVIEW.md](./ROTA_SUBSCRIPTIONS_EDIT_PREVIEW.md) |
| `POST /custom/v1/subscriptions/:id/edit/commit` | **404** (front chama, Express nao registra) | [ROTA_SUBSCRIPTIONS_EDIT_COMMIT.md](./ROTA_SUBSCRIPTIONS_EDIT_COMMIT.md) |

Guia de transicao: [APLICACAO_POS_CHECKOUT.md](./APLICACAO_POS_CHECKOUT.md).

## Jornada no front atual

```
Place Order
  POST /onboarding/subscription/checkout
  Stripe.js confirmCardPayment
  POST /onboarding/payment-intent/ack     (otimista; cobranca fecha no webhook)
  CTA /dashboard/plans
    GET  /subscriptions
    GET  /subscriptions/:id/detail
    POST /subscriptions/:id/actions       pause | reactivate | cancel | toggle_auto_renew | update_payment_method
    POST /subscriptions/:id/edit/preview
    POST /subscriptions/:id/edit/commit   (404 hoje)
```

O front de acoes (`onboardingApi.ts` `SubscriptionAction`) **nao** manda `change_plan` / `change_billing_frequency`. Troca de plano/prazo passa por edit preview + commit.

## Nao entra neste diretorio

Ja documentado em `docs-new/`: Pets, Plan, Email, geo, coupons, checkout.

Nao migrar do WP:

- `account-link`
- `session_id` / `x-session-token`
- `wc_create_order` / Flexible Subscriptions (`fsb_subscription`) como fonte de verdade
- `GET /geo/redirect`
