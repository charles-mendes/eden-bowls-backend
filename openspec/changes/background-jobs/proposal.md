# Proposal

## Why

Falhas depois do webhook Stripe, envios de e-mail que já foram reivindicados e a reconciliação do ledger só acontecem dentro do request HTTP. `MODE` (`http`, `cron`, `worker`, `all`) e `ENABLE_BACKGROUND_JOBS` são lidos e o modo é apenas logado; o processo continua servindo HTTP. Sem um agendador, um erro engolido depois do `INSERT` do evento, um claim de e-mail sem `sent_at`, ou um `current_period_end` atrasado ficam permanentes. A fila de produção e o vencimento local dependem desse período.

## What Changes

- Um segundo processo do mesmo código, com `MODE=cron`, executa um conjunto fechado de jobs. `MODE=http` (padrão de `.env.example` e `.env.qa.example`) continua só o servidor HTTP. `MODE=all` sobe HTTP e o agendador no mesmo processo. `ENABLE_BACKGROUND_JOBS=true` tem o mesmo efeito do agendador quando `MODE=http`. `MODE=worker` não ganha fila nova: neste change ele se comporta como `cron`.
- Jobs incluídos: retry de webhook Stripe já persistido, reconciliação paginada do ledger, reenvio de e-mails transacionais já previstos e não enviados, atualização de rastreio UPS de envios em trânsito, limpeza de refresh tokens expirados e retenção de eventos de webhook antigos.
- O webhook deixa de gravar `processed_at` no insert. O evento fica pendente até o dispatch terminar. A lista admin passa a distinguir pendente, falho e processado.
- O claim de e-mail que falha no SMTP deixa de bloquear o reenvio para sempre.
- Sem broker novo. MySQL já é o registro de idempotência (`event_id`, unique de mail claim) e passa a ser o lock do agendador.

## Capabilities

### New Capabilities

- `background-jobs`: agendamento, contratos de cada job (gatilho, frequência, idempotência, retry, falha, observabilidade) e o efeito visível no ledger, na fila de produção e na lista de webhooks.

### Modified Capabilities

- Nenhuma. `admin-market-scope` e `catalog-product-delete` não mudam de requisito.

## Impact

- Backend: `src/index.js`, `src/config/env.js`, webhook Stripe, mailer transacional, billing reconcile, UPS tracking, refresh tokens, migração de `stripe_webhook_events` e `subscription_mail_claims`.
- Admin: a lista de webhooks em Assinantes passa a mostrar estado real (pendente ou falho), não “processado” só porque a linha existe.
- Loja: nenhuma rota nova. O cliente sente o efeito indireto (e-mail que antes se perdia, período da assinatura alinhado à Stripe).
- Stripe: leitura (`events.retrieve`, `subscriptions.retrieve`) em lote limitado. Sem nova cobrança e sem reenviar o webhook para a Stripe.
- UPS: `track` só para envios ainda não entregues.
- E-mail: reenvio só dos templates que o mailer já dispara (`order_confirmed`, `admin_new_subscription`, `payment_failed`, `shipped`). OTP e convite continuam síncronos no request.
- Dependências: nenhuma fila externa. Lock com `GET_LOCK` do MySQL.
