# Design

## Context

See proposal.md for why. The API is one Express process (`src/index.js` always calls `app.listen`). `package.json` has no queue client. Idempotency already lives in MySQL: `stripe_webhook_events` primary key `(event_id, stripe_account)`, and `uniq_subscription_mail_claim` on subscription, template, and reference.

What the code does today, and why each candidate is in or out:

| Work already in the code | Today | In this change |
|---|---|---|
| Stripe webhook dispatch | Insert sets `processed_at` immediately. Dispatch errors are logged and the handler still returns 200. Stripe will not redeliver. `payload_summary` is not enough to re-dispatch. | Retry by `events.retrieve` |
| `AdminBillingService.reconcile` | Admin POST, first 100 rows, errors swallowed | Scheduled pages of 50, same upsert, no charge |
| Transactional mail | Claim insert, then SMTP. Failure leaves `sent_at` null and the unique key makes the next claim a duplicate, so it never retries. Templates wired: `order_confirmed`, `admin_new_subscription`, `payment_failed`, `shipped` | Resend unsent claims |
| Renewal, pause, resume, cancel, plan-changed, password-reset templates | Built for preview only. Nothing calls them | Out |
| OTP and staff invite | Sent inside the auth or invite request. OTP TTL is 10 minutes | Out |
| Production queue | Read model of `current_period_end`. Cycle row is written only when an operator changes status | Period refresh via reconcile. No auto status |
| UPS `refreshTracking` | One shipment, admin POST | Poll open shipments |
| `deleteExpired` on refresh tokens | Method exists, no caller | Daily tick |
| Catalog sync, backfill links, coupon sync | Operator POST, finishes in the request | Out |
| `PRIME_ENABLE_UPDATE` | Parsed, never read | Out |
| Privacy `due_at` | Shown in admin. No reminder mailer | Out |
| Checkout fingerprint | In-request lock, 120s TTL, not a table to sweep | Out |

## Goals / Non-Goals

**Goals:**

- Keep `MODE=http` as the only public server.
- Run the jobs in a second process of this same codebase, locked in MySQL.
- Make webhook and mail failure recoverable without a second broker.
- Keep Stripe and UPS calls bounded.

**Non-Goals:**

- Redis, RabbitMQ, Azure Queue, or any new network service.
- Charging, dunning, or sending the unused email templates.
- Moving catalog sync or checkout off the request.
- Auto-advancing production status.
- A privacy SLA reminder.

## Decisions

### Scheduler is a second Node process, lock is MySQL

`MODE=cron` (and `MODE=worker`, same behavior) bootstraps the existing services and runs an in-process timer loop. It does not call `listen`. `MODE=all`, or `MODE=http` with `ENABLE_BACKGROUND_JOBS=true`, starts the same loop beside the server.

Each tick takes `GET_LOCK(name, 0)`. Timeout 0 means skip if another process holds it. The lock is released in `finally`. Lock names are per job (`eden_job_webhook_retry`, and one name per job below).

Alternative considered: cron hitting an internal HTTP route. Rejected because it needs a shared secret and still runs the work inside the API process, which the proposal keeps free to stay HTTP-only. Alternative considered: a broker. Rejected because nothing in the repo speaks one, and the volume is periodic batch reads, not a stream.

### Job table is the domain tables, not a generic queue

Pending webhooks and unsent mail claims are already rows. A generic `jobs` table would duplicate that and invite a second writer. New columns only:

- `stripe_webhook_events`: `processed_at` becomes nullable. Add `attempts` (int, default 0), `last_error` (varchar 255, nullable), `next_attempt_at` (datetime, nullable), `failed_at` (datetime, nullable). Pending means `processed_at` and `failed_at` are null. The admin list maps that to `pending`, `failed`, or `processed` and returns `attempts` from the column. Existing rows have `processed_at` set, so they stay processed; no backfill of payloads.
- `subscription_mail_claims`: add `attempts` (int, default 0), `last_error` (varchar 255, nullable), `exhausted_at` (datetime, nullable).

Do not store the raw Stripe event. Retry calls `events.retrieve` on the account that owns the row. Stripe keeps events long enough for the 24 hour window. A missing event is terminal.

### Job contracts

Responsável de todos: o processo agendador. O request HTTP continua dono da primeira tentativa de webhook e de e-mail.

**Webhook retry**

- Trigger: timer, plus the inline first dispatch on `POST /stripe/v1/webhook/:account`.
- Frequency: 60s.
- Idempotência: dispatch já é por `event_id`. Mail claims e upsert do ledger são repetíveis. O handler HTTP não despacha de novo se a linha existe.
- Retry: até 8 tentativas ou 24h desde o insert. Espera mínima de 30s (`next_attempt_at`).
- Timeout: 30s por evento. Tick inteiro limitado a 20 eventos.
- Falha: incrementa `attempts`, grava `last_error` curto, agenda a próxima. Na última, `failed_at`. Não devolve 500 para a Stripe depois do insert.
- Observabilidade: log `job=webhook_retry` com scanned, succeeded, failed. Métrica `eden_job_last_success_timestamp{job}` e `eden_job_items_failed_total{job}`.
- Banco: update da linha do evento; upsert do ledger só se o dispatch chegar lá.
- Stripe: `events.retrieve` e as leituras que o dispatch já faz (`subscriptions.retrieve`). Sem criar cobrança.
- UPS / e-mail: só se o evento reprocessado for um que já dispara `shipped` ou os três e-mails do webhook. O claim impede o segundo envio.

**Ledger reconcile**

- Trigger: timer. O POST admin `/admin/billing/subscriptions/reconcile` permanece para um operador.
- Frequency: 60 min.
- Idempotência: upsert pelas mesmas colunas do reconcile atual (status, períodos, cancel_at_period_end, ids). Cursor em memória do tick mais um `last_id` guardado num lock auxiliar ou na própria query `id > ? ORDER BY id LIMIT 50`, com o cursor num arquivo não — gravar o último id numa linha de controle `background_job_cursors` (job name, cursor, updated_at) para o próximo tick continuar. Uma linha por job, não uma fila.
- Retry: a assinatura que falha fica de fora do avanço do cursor? Não. Avança o cursor mesmo assim e a falha volta na volta seguinte do ciclo, senão um id quebrado trava a fila. Contar a falha no log.
- Timeout: 15s por `subscriptions.retrieve`.
- Falha: log e segue. Sem `failed_at` por assinatura.
- Observabilidade: scanned, updated, failed.
- Banco: `stripe_subscriptions` apenas colunas já escritas pelo reconcile. Sem `subscription_production_cycles`.
- Stripe: somente retrieve. Sem invoice, sem update de subscription.
- UPS / e-mail: nenhum.

**Mail resend**

- Trigger: timer. A primeira tentativa continua em `sendClaimed`.
- Frequency: 5 min.
- Idempotência: unique key. O tick seleciona `sent_at IS NULL AND exhausted_at IS NULL AND claimed_at < now - 2 minutes`. Envia e só então `markSent`. Não chama `claimMailSend` de novo.
- Retry: 5 tentativas. A primeira do request conta.
- Timeout: 20s por SMTP.
- Falha: incrementa `attempts`. Na quinta, `exhausted_at`. A linha fica para auditoria.
- Observabilidade: sent, failed, exhausted. Sem endereço completo no log; o mailer já loga destinatário em falha — manter, sem corpo.
- Banco: update do claim.
- Stripe: nenhum.
- E-mail: SMTP dos quatro templates. Não cria template novo.
- UPS: nenhum.

**UPS tracking**

- Trigger: timer.
- Frequency: 30 min.
- Idempotência: `updateTracking` substitui o payload guardado. Não cria shipment.
- Retry: falha isolada não incrementa um teto; o próximo tick tenta de novo. Um shipment sem resposta não bloqueia os outros.
- Timeout: 10s, já alinhado à ordem de grandeza de `UPS_HTTP_TIMEOUT_MS` (5s hoje; o tick usa o menor entre 10s e o timeout do cliente).
- Falha: log, tracking anterior permanece.
- Observabilidade: scanned, updated, failed.
- Banco: colunas de tracking já atualizadas por `refreshTracking`.
- UPS: `track` apenas. Sem ship, sem void.
- Stripe / e-mail: nenhum neste tick. O e-mail `shipped` continua no momento em que o operador compra a etiqueta.

**Refresh cleanup**

- Trigger: timer diário.
- Frequency: 24h.
- Idempotência: `DELETE WHERE expires_at < now`.
- Retry: o próximo dia cobre falha. Sem teto.
- Timeout: uma statement.
- Falha: log. Não apagar em lote cego se a query falhar.
- Banco: `auth_refresh_tokens` (nome real da tabela via env, default do repositório).
- Stripe / UPS / e-mail: nenhum.

**Webhook retention**

- Trigger: timer diário.
- Frequency: 24h.
- Idempotência: `DELETE` de processados com `processed_at` anterior a 90 dias.
- Retry: próximo dia.
- Falha: log. Nunca incluir `failed_at IS NOT NULL` nem pendentes.
- Banco: só `stripe_webhook_events`.
- Stripe / UPS / e-mail: nenhum.

### HTTP server must survive a tick error

The loop catches per job. In `MODE=all` a thrown tick MUST NOT call `process.exit`. `MODE=cron` also stays up for the next tick.

### Metrics

`prom-client` is already mounted on `/metrics`. Register the two gauges/counters above in that same registry. No new scrape port.

## Risks / Trade-offs

- [Retry re-dispatches an event whose first attempt partially wrote the ledger] → Dispatch paths are upserts and mail claims are unique. Tests must cover invoice.paid twice.
- [events.retrieve needs the secret of that account] → Use the same account resolver as the webhook. Missing secret marks the event failed, no spin.
- [Reconcile cursor skips a broken id until the wrap] → Acceptable. The admin POST can still target a known subscription via the existing per-id sync. Document that a full cycle is `ceil(count/50)` hours.
- [Nullable processed_at changes the admin list] → Existing rows stay processed. New rows start pending. Admin already renders `state`.
- [Two cron containers] → `GET_LOCK` is connection-scoped. The tick must hold one connection until release. Do not run the tick on a pooled connection that returns to the pool mid-job.
- [GET_LOCK does not survive a killed process] → MySQL releases the lock when the connection drops.

## Migration Plan

1. Migrate columns before deploying the cron process. Old HTTP code ignores the new columns. Deploy HTTP first if the insert still writes `processed_at`: do not deploy the nullable insert before the column is nullable.
2. Order: migration, then HTTP that inserts pending and retries inline, then the cron process. Rollback of the cron process is stopping that container. Rollback of HTTP requires the column to stay nullable (old code writing `processed_at` still works).
3. QA: `MODE=http` on the API container, a second service with `MODE=cron` in compose. Do not set `ENABLE_BACKGROUND_JOBS` on the API container in QA, so a bug in the loop cannot take down checkout.

## Open Questions

None that change the spec. Retention of exhausted mail claims can be a later cleanup; this change keeps them.
