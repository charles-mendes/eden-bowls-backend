# Spec Delta

## Purpose

Runs the work that must survive a failed HTTP request: Stripe webhook dispatch, ledger refresh, transactional mail that was claimed but not sent, UPS tracking, and local cleanup. The public API process can keep serving HTTP only.

## ADDED Requirements

### Requirement: HTTP mode does not run scheduled work

With `MODE=http` and background jobs disabled, the process MUST serve the existing HTTP API and MUST NOT start scheduled jobs. The default configuration MUST remain HTTP-only. `MODE=cron` MUST run the scheduler and MUST NOT bind the public HTTP port. `MODE=all` MUST run both. Setting background jobs enabled while `MODE=http` MUST start the scheduler in that same process. `MODE=worker` MUST run the same scheduler as `MODE=cron` and MUST NOT introduce a second queue.

#### Scenario: Default process stays HTTP-only

- **WHEN** the process starts with `MODE=http` and background jobs disabled
- **THEN** the HTTP server listens and no scheduled job runs

#### Scenario: Cron process does not listen

- **WHEN** the process starts with `MODE=cron`
- **THEN** the scheduler runs and no public HTTP port is opened

### Requirement: Only one scheduler tick runs a given job

Two overlapping processes MUST NOT execute the same job tick at the same time. A tick that cannot acquire the lock MUST skip that job and MUST leave stored work unchanged. A tick MUST release the lock when it finishes or when its timeout elapses.

#### Scenario: Second tick skips

- **WHEN** a job tick is already running and another process starts the same job
- **THEN** the second tick does not call Stripe, UPS, or SMTP for that job

### Requirement: Webhook events stay pending until dispatch succeeds

Persisting a Stripe webhook MUST record the event as pending and MUST NOT mark it processed at insert time. The HTTP handler MUST return success to Stripe after the event is stored, including when the first dispatch fails, so Stripe delivery and local retry are not both the recovery path. If the event cannot be stored, the handler MUST return an error so Stripe can redeliver. A duplicate delivery of an event already stored MUST NOT dispatch it again from the HTTP handler.

The first dispatch MAY run inside the webhook request. On failure the event MUST remain pending with an attempt count and a next-attempt time. A scheduled retry MUST re-read the event from Stripe by id and account, then run the same dispatch. Retry MUST be idempotent for ledger writes and mail claims. The retry job MUST run at least once per minute, MUST take at most 20 events per tick, MUST wait at least 30 seconds between attempts for the same event, MUST stop after 8 attempts or 24 hours, and MUST spend at most 30 seconds on one event. A terminal failure MUST mark the event failed and MUST stop retrying it. Success MUST mark it processed.

The admin webhook list MUST return `pending`, `failed`, or `processed` from that stored state and MUST return the stored attempt count. It MUST NOT report an event as processed only because the row exists.

#### Scenario: Dispatch fails after the event is stored

- **WHEN** Stripe delivers a handled event, the row is stored, and dispatch throws
- **THEN** Stripe receives success, the event stays pending, and a later tick retries it

#### Scenario: Duplicate delivery does not dispatch twice

- **WHEN** Stripe delivers an event id that is already stored for that account
- **THEN** the handler acknowledges it and does not dispatch again

#### Scenario: Retry gives up

- **WHEN** an event has failed 8 times or the first failure is older than 24 hours
- **THEN** the event is marked failed, the admin list shows `failed`, and further ticks skip it

#### Scenario: Stripe no longer has the event

- **WHEN** a retry cannot retrieve the event from Stripe
- **THEN** the event is marked failed and no ledger or mail side effect is applied

### Requirement: Ledger reconcile refreshes subscription periods without charging

A scheduled reconcile MUST page through local subscription rows and refresh status, period start, period end, and cancel-at-period-end from Stripe. It MUST NOT create invoices, MUST NOT change prices, and MUST NOT cancel subscriptions. It MUST run at most once per hour, MUST read at most 50 subscriptions per tick, and MUST continue when one subscription fails. One subscription read MUST time out at 15 seconds. A failed row MUST remain as stored and MUST be eligible on a later tick. The manual admin reconcile endpoint MUST keep working and MUST NOT be limited to the first 100 rows as its only completeness mechanism; the scheduled job is what walks the rest of the ledger over successive ticks.

The production queue due date MUST keep being derived from the refreshed period end. The job MUST NOT create or advance production-cycle status.

#### Scenario: Missed webhook leaves the period stale

- **WHEN** Stripe has a newer period end than the local ledger and a reconcile tick includes that subscription
- **THEN** the local period end matches Stripe and the production queue due date uses that period

#### Scenario: One Stripe error does not stop the page

- **WHEN** retrieve fails for one subscription in the page
- **THEN** the other subscriptions in that page are still refreshed and the failed row is unchanged

#### Scenario: Reconcile does not move production status

- **WHEN** a reconcile tick updates a subscription that has a production cycle
- **THEN** the cycle status and note stay as the operator left them

### Requirement: Claimed transactional mail is resent until sent or exhausted

The mailer MUST keep claiming a send at most once per subscription, template, and reference. Templates in scope are only `order_confirmed`, `admin_new_subscription`, `payment_failed`, and `shipped`. If SMTP fails, the claim MUST stay unsent and a later tick MUST be able to send that same claim. The retry tick MUST run at least every 5 minutes, MUST ignore claims newer than 2 minutes, MUST send at most 20 claims per tick, MUST allow at most 5 attempts, and MUST spend at most 20 seconds on one send. After 5 failures the claim MUST stay unsent, MUST be marked exhausted, and MUST NOT be retried. A claim already marked sent MUST NOT be sent again. OTP and staff-invite mail MUST remain synchronous on the request that created them and MUST NOT enter this retry.

#### Scenario: SMTP failure is retried

- **WHEN** a claim is stored and the first SMTP send throws
- **THEN** a later tick sends that claim once and then records it as sent

#### Scenario: Duplicate claim is not a second email

- **WHEN** a claim for the same subscription, template, and reference is already sent
- **THEN** a new send for that key does not call SMTP

#### Scenario: Exhausted claim stops

- **WHEN** a claim has failed 5 times
- **THEN** later ticks do not call SMTP for it

### Requirement: In-transit UPS shipments refresh tracking

A scheduled tick MUST call UPS tracking for shipments that have a tracking number and are not delivered or voided. It MUST run at most every 30 minutes, MUST take at most 20 shipments per tick, and MUST spend at most 10 seconds on one track call. A track failure MUST leave the stored tracking as it was and MUST NOT void the shipment. The job MUST NOT buy labels or create shipments.

#### Scenario: Open shipment is polled

- **WHEN** a shipment has a tracking number and is not delivered or voided
- **THEN** a tick updates the stored tracking from UPS

#### Scenario: Delivered shipment is skipped

- **WHEN** a shipment is already delivered
- **THEN** the tick does not call UPS for it

### Requirement: Expired refresh tokens are deleted

A daily tick MUST delete refresh-token rows whose expiry is in the past. It MUST NOT delete unexpired or merely rotated rows that are still inside the replay window. The tick MUST be idempotent.

#### Scenario: Expired row is removed

- **WHEN** the daily tick runs and a refresh token expired before now
- **THEN** that row is deleted

#### Scenario: Live token remains

- **WHEN** a refresh token expires in the future
- **THEN** the daily tick leaves it in place

### Requirement: Old processed webhook events are deleted

A daily tick MUST delete webhook events that are processed and older than 90 days. It MUST NOT delete pending or failed events, regardless of age.

#### Scenario: Old processed event is removed

- **WHEN** a processed event is older than 90 days
- **THEN** the daily tick deletes it

#### Scenario: Failed event is kept

- **WHEN** a failed event is older than 90 days
- **THEN** the daily tick leaves it in place

### Requirement: Each tick is observable

Every tick MUST log the job name, duration, counts of scanned, succeeded, and failed items, and MUST NOT log raw webhook bodies, card data, or SMTP credentials. A tick failure MUST be an error log and MUST NOT crash the HTTP server when both run in one process. Metrics MUST expose the last tick result per job name.

#### Scenario: Failed item is counted

- **WHEN** a tick processes a page and one item fails
- **THEN** the log includes that job name and a failed count of at least one, and the process keeps running
