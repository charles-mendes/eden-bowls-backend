# Design

## Context

Ver proposal.md (Why). Fatos do código que moldam a abordagem:

- `src/api/routes/onboarding-subscription-checkout.routes.js:34` responde `HttpError` com `details.code` direto e só chama `next(error)` no resto; o middleware de `src/app.js:261-267` só loga `>= 500`.
- `OnboardingSubscriptionCheckoutService.checkout` já calcula `attempt_id` e `checkout_context_fingerprint` (`src/core/checkout-idempotency.js`); snapshot e ledger só são gravados com a assinatura criada.
- `stripeErrorInfo` (`src/infrastructure/stripe/stripe-billing-client.js:42`) já extrai `stripe_code/type/param`.
- Rotas admin usam `buildRequireAdminPermission(permission, { market: 'none'|'query'|'record' })` com escopo de mercado do staff (`src/core/admin-market-scope`).
- `hashIp` está em `src/core/privacy.js` (usado por `privacy.service.js`).
- `stripe-webhook.service.js`: o catch de `handle()` reagenda até 8 tentativas/24h e só `markFailed` é terminal; `invoice.paid` sem cliente faz `logger.warn` e retorna, `handleSubscriptionChanged` retorna em silêncio; `payment_intent.payment_failed` e `invoice.payment_failed` terminam com 200.
- `constrainMarketQuery` usa todos os mercados do staff quando `market` falta; mercado fora do escopo dá 403 `market_forbidden`.
- `payment-intent/ack` responde `HttpError` só com `{ success, message }`, sem `details`.
- O validator aceita `attempt_id` até 128 caracteres.
- Migrations em `src/infrastructure/migrations/` (última `1700000000089`), executadas com lock no deploy.
- Jobs agendados seguem `background-jobs` (lock por job, tick de 24h).

## Goals / Non-Goals

**Goals:** gravação best-effort, sem mudar resposta; um ponto único de registro reaproveitado por rotas, webhook e admin; leitura filtrada por mercado.

**Non-Goals:** alertas, métricas, tela na loja, replay de tentativas, mudar o tratamento de erro existente das rotas.

## Decisions

1. **Três tabelas, não reaproveitar `admin_audit_events` nem `stripe_webhook_events`.** Auditoria de operador e idempotência têm donos e retenções próprias. Eventos de webhook vão em `customer_purchase_events` com `area = webhook`, `stripe_event_id`, `attempt_row_id` nulo e `user_id` nulo quando não resolvido. Alternativa (tabela de webhook separada) rejeitada: mais uma retenção e outra listagem.

   - `customer_purchase_attempts`: `id` bigint PK, `user_id` (not null), `market` enum(`br`,`us`) not null, `email`, `stripe_account` nullable, `correlation_id` char(36) UUID, `attempt_id` nullable, `area`, `term_months`, `currency`, `promotion_code_id`, `subscription_id`, `status` enum(`in_progress`,`paid`,`completed`,`failed`), `final_step`, `http_status`, `error_code`, `error_message` varchar(500), `stripe_code`, `stripe_type`, `stripe_param`, `ip_hash` nullable, `started_at`, `finished_at`, `updated_at`. Únicos: (`user_id`,`market`,`correlation_id`); índices (`user_id`,`market`,`started_at`), (`market`,`status`,`started_at`), (`attempt_id`). `attempt_id` varchar(128).
   - `customer_purchase_events`: `id`, `attempt_row_id` FK nullable `ON DELETE CASCADE`, `user_id` nullable (not null salvo `area = webhook`, garantido no service), `market` not null, `area`, `step`, `action`, `outcome` (`ok|failed`), `pet_id`, `subscription_id`, `stripe_event_id`, `stripe_event_type`, campos de erro, `created_at`. Índices (`user_id`,`market`,`created_at`), (`market`,`area`,`created_at`).
   - `customer_purchase_config_events`: `id`, `market` not null, `stripe_account`, `actor_admin_id`, `action`, `target_ref` (id do cupom/produto/variação, não a configuração), `outcome`, `error_code`, `created_at`. Índice (`market`,`created_at`).

2. **Correlação por visita.** A loja guarda um UUID em `sessionStorage`, compartilhado por `/onboarding`, `/plan` e `/checkout`, trocado quando o mercado muda e depois do paid; envia `X-Purchase-Correlation-Id`; o mercado da página vem do `X-Eden-Country`/`X-Eden-Domain` que a loja já envia (sem header novo de mercado). O CORS passa a aceitar `X-Purchase-Correlation-Id`. A API valida UUID e faz upsert da tentativa por (`user_id`,`market`,`correlation_id`); sem header (ou inválido), gera um UUID no servidor e não usa o `attempt_id` como correlação. Alternativa (um id por página) rejeitada: uma compra virava três tentativas.

   **Máquina de status.** Evento de passo nunca muda status, exceto as transições: criação da assinatura falha / `confirm_card_payment` failed / `payment_failed` webhook / commit de assinatura falho → `failed`; ack 200 ou `payment_intent.succeeded`/`invoice.paid` resolvido → `paid`; commit/ação de assinatura ok → `completed`. `paid` é terminal e sobrescreve `failed`; `failed` não sobrescreve `paid` (update condicional `WHERE status <> 'paid'`). Quando o checkout calcula o `attempt_id`, faz update na mesma linha. Market vem do endereço salvo; sem endereço, do header; sem os dois, a rota não grava (não chuta mercado). A unicidade inclui `market`, então a mesma correlação em outro mercado abre outra linha.

3. **Ponto de registro: middleware de app com tabela de rotas + hook explícito.** Um middleware montado logo após o bearer token, com a tabela das rotas listadas (método, padrão, área, passo, campos permitidos), envolve `response.json` para capturar status e `details.code` do que a rota já responde (resolve o caso do checkout que não chama `next`) e grava após `finish`, com `setImmediate` e `catch` que só loga. `extract` devolve somente os campos permitidos (pet_id, termo, moeda, subscription_id, promotion_code_id); nunca recebe o body inteiro no repositório. Erros que passam por `next(error)` são capturados pelo mesmo wrapper porque o middleware de `app.js` também chama `response.json`. Requisição sem `request.currentUser` não grava. O catch de cada rota da trilha e o handler de erro global guardam o erro original em `response.locals.purchaseTrailError`; o `error_code` e os campos `stripe_*` saem dele, porque várias rotas (ack, recurrence) não devolvem `details` no corpo. O service de checkout ganha um callback opcional para devolver `attempt_id`, `stripe_*` e `promotion_code_id` em `response.locals`. Alternativa (logar no middleware de erro global) rejeitada: perde as respostas diretas e os sucessos.

4. **Rota de client events.** `POST /api/v1/onboarding/checkout/client-events`, auth de cliente, body validado por allowlist (`step`, `outcome`, `stripe_code`, `stripe_type`, `stripe_param`, `message` ≤ 500, `attempt_id`, `correlation_id`); campos fora da lista são descartados, não rejeitados, e o endpoint responde 202 mesmo se o insert falhar. Grava sempre; `confirm_card_payment` failed fecha `failed`; nenhum valor do navegador marca `paid` (o body não é conferido na Stripe). Rate limit igual ao das rotas de onboarding.

5. **Webhook.** O gancho fica no service (a rota responde 200 `{ received: true }` mesmo em falha, então o wrapper de `response.json` não serve). Gravar em: `markFailed` terminal; retornos de cliente não resolvido (`invoice.paid` com warn, `handleSubscriptionChanged`); `payment_intent.payment_failed` e `invoice.payment_failed` (fecham `failed`); `payment_intent.succeeded`/`invoice.paid` resolvidos fecham `paid` a tentativa ligada pelo `attempt_id` do ledger/snapshot. O catch que reagenda retry não grava. Chamar o recorder com `market` derivado da rota (`br` / `us` / legado `us`) e `user_id` via lookup do ledger por subscription/customer id. Sem payload.

6. **Configuração.** Nos services admin de cupom/promos/percentual, frete, catálogo, variação e plan-settings, depois da auditoria existente, gravar config event com o market da conta alterada. Falha de checkout por cupom/price/frete já carrega o `error_code` no evento do cliente; não há FK entre as tabelas.

7. **Leitura.** `GET /api/v1/admin/users/:userId/purchase-trail?market=&limit=&before=` com `requireAdminPermission('billing.subscribers.read', { market: 'query' })`, paginado por `started_at`, eventos embutidos por tentativa (até 50). `GET /api/v1/admin/purchase-trail/config-events?market=` com a mesma permissão. `market` ausente ou inválido → 400, validado na rota antes de `constrainMarketQuery` (que sem `market` usaria todos os mercados do staff); fora do escopo segue 403 `market_forbidden`. `readonly` tem a permissão; `veterinarian` não. Painel: aba "Trilha de compra" na ficha do cliente com seletor de mercado, somente leitura.

8. **Retenção: 180 dias**, job `purchase-trail-retention` em lote de 1000 por `DELETE ... ORDER BY id LIMIT`, mesmo corte para BR e US. Cobre o ciclo de reclamação/chargeback sem crescer sem limite.

## Risks / Trade-offs

- [Wrapper de `response.json` grava algo que não devia] → recorder só aceita campos tipados; teste que injeta body com CPF/client_secret e verifica que nada vai ao insert.
- [Volume de eventos de sucesso] → só passos listados; retenção 180 dias; índices compostos.
- [Cliente forja client events] → autenticado, só afeta tentativas do próprio `user_id`, nunca marca `paid`.
- [Ack falha e webhook demora] → tentativa fica `in_progress` com o evento do navegador visível; o operador vê que a loja tratou como pago e o servidor ainda não confirmou.
- [Insert lento atrasa resposta] → gravação após `finish`, fora do caminho da resposta.
- [Mercado indeterminado antes do endereço sem header] → não grava; loja sempre envia o header.

## Migration Plan

Migration aditiva `1700000000090-create-customer-purchase-trail` (três tabelas). Deploy da API antes da loja: sem header, a API usa correlação do servidor. Rollback: desmontar middlewares; as tabelas podem ficar ou ser removidas por migration `down`.
