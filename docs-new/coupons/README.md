# Cupons Stripe (1a compra) no backend Node

Documentacao da logica de desconto automatico de **primeira compra** no `eden-bowls-backend`.

Identidade e sempre o **JWT**. Nao existe sessao de onboarding, `session_id`, `x-session-token` nem `account-link`. O usuario e `request.currentUser.id`. O estado do onboarding mora em `onboarding_user_state` (PK `user_id`).

Escopo: desconto automatico de primeira compra, aplicado so na **primeira fatura mensal** da assinatura. O cliente nao digita cupom. Cupons WooCommerce nao entram nesta logica.

Base local: **`http://localhost:3000`**. Prefixo: `/api/v1`.

| Rota | Metodo | JWT | Liga com coupon Stripe? | Estado Node |
|---|---|---|---|---|
| `/onboarding/recommendation` | GET | opcional | Nao | implementado (nutricao) |
| `/onboarding/plan/snapshot` | GET/POST | opcional | So informativo (`plan_terms` 10/25/40) | implementado |
| `/onboarding/discount/eligibility` | GET | opcional | Elegibilidade | **stub** (JWT = elegivel) |
| `/onboarding/plan/preview` | POST | opcional | Nao aplica desconto | implementado (preco cheio) |
| `/onboarding/plan-selection` | POST | opcional | Nao grava `promo_id` | persiste so com JWT |
| `/onboarding/subscription/checkout` | POST | **obrigatorio** | **Ponto de apply** | **stub** (sem Stripe) |
| `/subscriptions/:id/edit/preview` | POST | **obrigatorio** | Nunca reaplica 1a compra | stub com contrato correto |

Detalhe: [STRIPE_COUPONS_FIRST_PURCHASE.md](./STRIPE_COUPONS_FIRST_PURCHASE.md).
