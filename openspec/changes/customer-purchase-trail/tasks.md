# Tasks

## 1. Schema e recorder

- [x] 1.1 Migration `1700000000090-create-customer-purchase-trail` com as três tabelas, enums e índices do design; verificar com `RUN_DB_INTEGRATION_TESTS=true` no teste de migration afetado e `down` reversível.
- [x] 1.2 `customer-purchase-trail.repository.js` em SQL direto, sem entidade TypeORM (como `media_assets`), (upsert de tentativa por user/market/correlation, insert de evento, insert de config event, listagem por user+market, delete por corte); teste `tests/customer-purchase-trail.repository.test.js`.
- [x] 1.3 `customer-purchase-trail.service.js` (recorder) com allowlist de campos, truncamento de mensagem em 500, `ip_hash` via `hashIp` de `src/core/privacy.js`, resolução de mercado (endereço → header → não grava), sem usuário não grava, máquina de status (passo intermediário não muda status, paid só pelo servidor e sobrescreve failed, failed não sobrescreve paid, completed para assinatura) e erros engolidos com log; teste `tests/customer-purchase-trail.service.test.js` cobrindo: body com CPF/client_secret/payment_method não chega ao insert, mesma correlação em outro mercado abre outra tentativa, insert que lança não propaga.

## 2. Middleware e rotas da loja

- [x] 2.1 Middleware `purchase-trail.middleware.js` (wrap de `response.json`, gravação após `finish`, leitura de `X-Purchase-Correlation-Id` e do mercado de `X-Eden-Country`/`X-Eden-Domain`, erro original em `response.locals.purchaseTrailError`); teste `tests/purchase-trail.routes.test.js` incluindo 401 sem usuário não grava e 401 com usuário resolvido grava só o status; correlation inválido ou ausente gera UUID e não copia `attempt_id`.
- [x] 2.2 Montar nas rotas de onboarding de pets e recomendação (pet_id + ação, sem corpo); teste: falha de pet grava `user_id`, `market`, `error_code`.
- [x] 2.3 Montar nas rotas de plano (termo, moeda, recusa de life stage); teste: falha de plano grava `user_id`, `market`, `error_code`.
- [x] 2.4 Montar nas rotas de checkout (zipcode, address, shipping, sales-tax, subscription/preview, subscription/checkout, payment-intent/ack); `attempt_id`, `promotion_code_id` e `subscription_id` saem da resposta do checkout e `stripe_*` do erro em `response.locals.purchaseTrailError` (vale também para o ack, cujo corpo não traz `details`); ack 200 fecha `paid`; testes: falha de validação do checkout grava `error_code` e mantém `in_progress`, erro de CEP seguido de ack 200 termina `paid`, ack com HttpError grava o `error_code` do servidor, 502 `stripe_subscription_failed` grava `stripe_code/type/param`, insert que lança mantém o mesmo status HTTP e `details.code`.
- [x] 2.5 Rota `POST /api/v1/onboarding/checkout/client-events` (auth cliente, allowlist, 202); testes: responde 202 mesmo com insert falhando; `confirm_card_payment` failed grava evento sem body Stripe e fecha `failed`; ok fica `in_progress`; ok + ack failed fica `in_progress` com os dois eventos.
- [x] 2.6 Montar nas rotas de `subscriptions/:subscriptionId` (edit/preview, edit/commit, actions, skip, reschedule, packs) com mercado do `stripe_account` do ledger; teste do route file afetado: commit falho fecha `failed`, commit ok fecha `completed`.

## 3. Webhook e configuração

- [x] 3.1 Em `stripe-webhook.service.js`, gravar no `markFailed` terminal e nos retornos de cliente não resolvido (`invoice.paid` com warn, `handleSubscriptionChanged`), com market por rota (br/us/legado us) e `user_id` via ledger; testes: `/webhook/br` que esgota tentativas grava `market = br` e `user_id` resolvido; falha que ainda será retentada não grava; nada é inserido além da linha existente em `stripe_webhook_events`.
- [x] 3.2 Gravar `payment_intent.payment_failed` e `invoice.payment_failed` (fecham `failed` a tentativa ligada) e fechar `paid` em `payment_intent.succeeded`/`invoice.paid` resolvidos; testes: `invoice.payment_failed` sem client event grava evento com `user_id`; `invoice.paid` depois de `failed` passa a `paid`.
- [x] 3.3 Config events em cupom de primeira compra, promos sync, percentual do termo, shipping settings, catalog sync (geral e por produto), ativação de variação e plan-settings; teste: criar cupom grava config event do market sem `user_id` e `admin_audit_events` continua gravado.

## 4. Leitura admin e manifesto

- [x] 4.1 Rotas `GET /api/v1/admin/users/:userId/purchase-trail` e `GET /api/v1/admin/purchase-trail/config-events` com `billing.subscribers.read` e `market: 'query'`; até 50 eventos por tentativa; validação própria de `market` antes de `constrainMarketQuery`; testes: tentativa US não aparece com `market=br`; `market` ausente ou inválido → 400; fora do escopo → 403 `market_forbidden`; `readonly` lê e `veterinarian` não; token de cliente → 401/403.
- [x] 4.2 `npm run routes:manifest` e commit de `docs/api-routes.json`; rodar `npx jest --runTestsByPath tests/api-routes-manifest.test.js`.

## 5. Retenção

- [x] 5.1 Job `purchase-trail-retention` (lock próprio, 24h, 180 dias, lotes de 1000) registrado no scheduler; teste do job: BR e US de 181 dias apagados, 179 dias mantido.

## 6. Loja e painel

- [x] 6.1 Loja (`eden-bowls`): guardar um correlation id por visita em `sessionStorage` (compartilhado por onboarding, plano e checkout; trocado ao mudar de mercado e após paid), enviar headers nas chamadas da trilha e reportar `retrievePaymentIntent`, `confirmCardPayment` e falha do ack na rota de client events, sem mudar o fluxo de ack engolido; verificar com o teste Vitest do checkout.
- [x] 6.2 Painel (`eden-bowls-admin`): `npm run contract:sync`, commit de `contracts/backend-routes.json`, aba somente leitura "Trilha de compra" na ficha do cliente com seletor de mercado e lista de config events; verificar com Vitest e screenshot Playwright.
