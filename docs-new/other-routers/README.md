# Pos-checkout no backend Node

Documentacao para **implementar** webhook Stripe + dashboard de assinatura no `eden-bowls-backend`.

Checkout, ACK, frete, lookup, cartoes e preview Stripe ja estao em [../checkout](../checkout/). Place Order (create Stripe + gaps): [../subscription-checkout](../subscription-checkout/README.md). Este diretorio cobre o bloco seguinte: **cobranca fecha no webhook** e **Meu Plano / Edit** leem o ledger.

Identidade: **JWT**. Sem `session_id`. Sem Woo `fsb_subscription`. Persistencia alvo: ledger `stripe_subscriptions` por `user_id` + `onboarding_user_state.checkout_reference` ja gravado no Place Order.

Contrato do front:

- `eden-bowls/src/services/onboardingApi.ts` (`fetchUserSubscriptions`, `fetchUserSubscriptionDetail`, `runSubscriptionAction`)
- `eden-bowls/src/services/subscriptionEditApi.ts` (`previewSubscriptionEdit`, `commitSubscriptionEdit`, `updateSubscriptionPaymentMethod`)
- `MyPlan.tsx`, `PlanDetail.tsx`, `EditSubscription.tsx`

Guia de transicao (ordem, arquivos, schema): [APLICACAO_POS_CHECKOUT.md](./APLICACAO_POS_CHECKOUT.md).

## O que ja entrou no Node (fora deste diretorio)

| Responsabilidade | Estado no codigo atual |
|---|---|
| Place Order Stripe | `POST /api/v1/onboarding/subscription/checkout` — `StripeBillingClient.createOnboardingSubscription`; grava `checkout_reference` + `cus_` em `wp_usermeta._hsr_stripe_customer_id` |
| ACK do PaymentIntent | `POST /api/v1/onboarding/payment-intent/ack` — persiste status em `checkout_reference`; **nao** confirma cobranca |
| Customer Stripe | `StripeCustomerStore` |
| Frete 1a invoice | checkout injeta `add_invoice_items` via `STRIPE_SHIPPING_PRODUCT_ID` |
| Eligibility 1a compra | le `WP_HSR_STRIPE_SUBSCRIPTIONS_TABLE_NAME` (`wp_hsr_stripe_subscriptions`); tabela ausente = sem assinatura ativa |
| Preview imposto US | `StripeBillingClient.previewSubscriptionInvoice` |

## O que falta converter

| WP (legado) | Node (hoje) | Documento |
|---|---|---|
| `POST /custom/v1/stripe-webhook` | **nao existe** | [ROTA_STRIPE_WEBHOOK.md](./ROTA_STRIPE_WEBHOOK.md) |
| `GET /custom/v1/subscriptions` | rota existe, stub `[]` | [ROTA_SUBSCRIPTIONS.md](./ROTA_SUBSCRIPTIONS.md) |
| `GET /custom/v1/subscriptions/:id/detail` | rota existe, stub Premium/Milo | [ROTA_SUBSCRIPTIONS_DETAIL.md](./ROTA_SUBSCRIPTIONS_DETAIL.md) |
| `POST /custom/v1/subscriptions/:id/actions` | rota existe, stub `queued` (nao chama Stripe) | [ROTA_SUBSCRIPTIONS_ACTIONS.md](./ROTA_SUBSCRIPTIONS_ACTIONS.md) |
| `POST /custom/v1/subscriptions/:id/edit/preview` | rota existe, stub `hash-123` | [ROTA_SUBSCRIPTIONS_EDIT_PREVIEW.md](./ROTA_SUBSCRIPTIONS_EDIT_PREVIEW.md) |
| `POST /custom/v1/subscriptions/:id/edit/commit` | **404** (`createApp` nao registra) | [ROTA_SUBSCRIPTIONS_EDIT_COMMIT.md](./ROTA_SUBSCRIPTIONS_EDIT_COMMIT.md) |

## Jornada no front atual

```
Place Order
  POST /api/v1/onboarding/subscription/checkout
  Stripe.js confirmCardPayment
  POST /api/v1/onboarding/payment-intent/ack     (otimista; cobranca fecha no webhook)
  CTA /dashboard/plans
    GET  /api/v1/subscriptions
    GET  /api/v1/subscriptions/:id/detail
    POST /api/v1/subscriptions/:id/actions       pause | reactivate | cancel | toggle_auto_renew | update_payment_method
    POST /api/v1/subscriptions/:id/edit/preview
    POST /api/v1/subscriptions/:id/edit/commit   (404 hoje)
```

O front de acoes (`SubscriptionAction`) **nao** manda `change_plan` / `change_billing_frequency`. Troca de plano/prazo passa por edit preview + commit.

## Nao entra neste diretorio

Ja documentado em `docs-new/`: Pets, Plan, Email, geo, coupons, checkout.

Nao migrar do WP:

- `account-link`
- `session_id` / `x-session-token`
- `wc_create_order` / Flexible Subscriptions (`fsb_subscription`) como fonte de verdade
- `GET /geo/redirect`
