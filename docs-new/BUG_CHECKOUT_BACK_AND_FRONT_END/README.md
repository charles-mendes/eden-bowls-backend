# Checkout local: o que parece bug e nao e

Pasta de investigacao do Place Order (front + Node). Antes de tratar `incomplete`, Meu Plano vazio ou cupom de 1a compra na 2a tentativa como regressao, conferir se o **webhook Stripe chegou no localhost**.

O pagamento no cartao e o ACK **nao** fecham o dominio. Quem fecha e `POST /stripe/v1/webhook` (`invoice.paid`).

Guia completo do CLI: [STRIPE_CLI_WEBHOOK_LOCAL.md](./STRIPE_CLI_WEBHOOK_LOCAL.md).

| Arquivo | O que e |
|---|---|
| [STRIPE_CLI_WEBHOOK_LOCAL.md](./STRIPE_CLI_WEBHOOK_LOCAL.md) | Como encaminhar webhook de test para o Node |
| [context.md](./context.md) | Captura crua de um checkout (curl / respostas) |
| [tela_checkout.png](./tela_checkout.png) | Screenshot da tela |

Contrato do webhook: [../other-routers/ROTA_STRIPE_WEBHOOK.md](../other-routers/ROTA_STRIPE_WEBHOOK.md).
Create + efeitos: [../subscription-checkout/04-stripe-create-webhook-e-efeitos.md](../subscription-checkout/04-stripe-create-webhook-e-efeitos.md).
