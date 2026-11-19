# Proposal

## Why

Quando algo falha no caminho até a compra (onboarding, plano, checkout, confirmação Stripe) ou numa mudança de assinatura já comprada, a mensagem existe só no estado React da loja e some no refresh. A API não guarda a tentativa ligada ao cliente e ao mercado: a rota de checkout responde o `HttpError` com `details.code` sem chamar `next(error)`, o middleware de erro de `src/app.js` só loga `>= 500` no logger do processo (sem user id, sem mercado, sem attempt id), e a confirmação do cartão roda só no navegador. O operador não consegue reconstruir o que aconteceu.

## What Changes

- Novas tabelas MySQL `customer_purchase_attempts`, `customer_purchase_events` e `customer_purchase_config_events`, sempre com `market` (`br|us`) não nulo e `user_id` do cliente nas linhas de jornada.
- Registro (só gravação, sem mudar regra de negócio) nas rotas de onboarding de pets e recomendação, plano, checkout, assinatura já comprada, webhook Stripe (falha terminal, cliente não resolvido e `payment_failed`) e configurações admin que bloqueiam a compra do mercado.
- Header de correlação gerado pela loja uma vez por visita (`X-Purchase-Correlation-Id`), compartilhado por onboarding, plano e checkout, amarrado ao `attempt_id` quando o checkout o cria; não atravessa de mercado.
- Rota nova autenticada da loja `POST /api/v1/onboarding/checkout/client-events` para reportar `retrievePaymentIntent`, `confirmCardPayment` e a falha do `payment-intent/ack`, sem body do Stripe.
- `paid` só por confirmação do servidor (ack 200 ou webhook resolvido); evento do navegador nunca marca pago.
- Rotas admin somente leitura: `GET /api/v1/admin/users/:userId/purchase-trail?market=` e `GET /api/v1/admin/purchase-trail/config-events?market=`.
- Job diário de retenção: apaga linhas com mais de 180 dias, BR e US pelo mesmo prazo.
- Painel: aba somente leitura na ficha do cliente, com mercado visível. Loja: correlation id e envio dos eventos do navegador; nenhuma tela de histórico.
- Falha ao gravar a trilha nunca altera status HTTP nem esconde o erro original.
- Manifesto de rotas (`docs/api-routes.json`) e contract do painel atualizados.

Fora: login, cadastro, OTP e reset de senha (exceto o 401 recebido numa página da trilha), tecla do autocomplete, bytes de foto, qualquer mudança de regra de cupom, frete ou pagamento. `admin_audit_events` e `stripe_webhook_events` continuam como estão.

## Capabilities

### New Capabilities
- `customer-purchase-trail`: trilha persistida por cliente e mercado das tentativas de compra e de mudança de assinatura, dos eventos de cada passo, dos eventos de configuração de mercado, regras de privacidade, retenção e leitura admin.

### Modified Capabilities
- `background-jobs`: novo job agendado de retenção da trilha de compra.

## Impact

- API: `src/api/routes/onboarding-*.routes.js`, `onboarding-subscription-checkout.routes.js`, rotas de `subscriptions/:subscriptionId/*`, rotas admin de Stripe/cupom, frete e catálogo, `src/app.js` (middleware de erro), `src/services/stripe-webhook.service.js`, `src/services/onboarding-subscription-checkout.service.js`, novas entidades/repository/service, nova migration em `src/infrastructure/migrations/`, scheduler de jobs.
- Rotas novas em `/api/v1`: `docs/api-routes.json`, `contracts/backend-routes.json` no painel.
- Loja (`eden-bowls`): header de correlação e chamada da rota de client events.
- Painel (`eden-bowls-admin`): aba da trilha na ficha do cliente.
- Sem dependência externa nova.
