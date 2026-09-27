# Proposal

## Why

A operação já cobra, pausa, retoma, cancela, altera plano e envia tigelas, mas o cliente só recebe e-mail no primeiro ciclo pago, na falha de cobrança e no envio UPS. Os templates de renovação, pausa, retomada, cancelamento e troca de plano existem e não são disparados. Sem essas cartas, o cliente não tem recibo do ciclo nem confirmação das ações que faz no dashboard.

## What Changes

- Ligar os cinco templates que hoje só aparecem no preview: renovação, pausa, retomada, cancelamento e troca de plano. Não criar templates novos para esses eventos.
- Tratar "pagamento aprovado" como os e-mails que já descrevem a cobrança: `order_confirmed` no primeiro `invoice.paid` (`subscription_create`) e `renewal` nos ciclos seguintes (`subscription_cycle`). Não criar um template separado de pagamento aprovado.
- Manter a notificação interna existente (`admin_new_subscription` para `MAIL_OPS_TO`) só no primeiro ciclo pago. Não criar e-mails internos para pausa, envio, falha ou cancelamento: o painel já mostra fila de produção e assinantes.
- Manter `shipped` no fluxo UPS (mercado US), que já dispara ao criar a etiqueta. O mercado BR não tem evento de envio com rastreio; a fila de produção para em `ready` e não ganha status novo neste change.
- Enviar falha de pagamento uma vez por fatura, a partir de `invoice.payment_failed`, para não duplicar com `payment_intent.payment_failed`.
- Corrigir a idempotência que hoje trava o reenvio: um claim com `sent_at` nulo conta como duplicata, então uma falha de SMTP nunca volta a ser tentada. Retry fica no envio (tentativas curtas no mesmo processo), sem fila nem job.
- Locale continua a regra atual: conta Stripe `br` ou endereço BR em pt-BR; o restante em en-US.

## Capabilities

### New Capabilities

- `transactional-emails`: e-mails de assinatura ao cliente e o aviso interno do primeiro ciclo pago, com disparo, destinatário, mercado, erro, retry e idempotência.

### Modified Capabilities

- Nenhuma. `admin-market-scope` e `catalog-product-delete` não descrevem e-mail.

## Impact

- Backend: `transactional-mailer`, `stripe-webhook.service`, `subscription-mail-claims.repository`, commit de edição de plano, testes de mailer, webhook e commit.
- Loja e painel não mudam de contrato. A loja já chama `POST /api/v1/subscriptions/:id/actions` e o commit de edição; o e-mail é efeito do backend depois que o Stripe confirma.
- Fora de escopo: redefinição de senha (template existe, fluxo da loja não chama API), OTP, convite de staff, e-mails de privacidade, CI, jobs e storage.
