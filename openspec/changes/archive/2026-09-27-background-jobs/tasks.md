# Tasks

## 1. Schema

- [x] 1.1 Add a migration that makes `stripe_webhook_events.processed_at` nullable and adds `attempts`, `last_error`, `next_attempt_at`, and `failed_at`. Verify with the migration test that existing rows keep `processed_at` and new inserts can leave it null.
- [x] 1.2 Add `attempts`, `last_error`, and `exhausted_at` to `subscription_mail_claims`. Verify with the migration test that the unique key `(stripe_subscription_id, template, reference_id)` is unchanged.
- [x] 1.3 Add `background_job_cursors` (`job_name` primary key, `cursor`, `updated_at`). Verify the migration test creates the table and a second up is a no-op.

## 2. Webhook state

- [x] 2.1 Stop writing `processed_at` on insert. Set it only after dispatch succeeds. On dispatch throw, leave the row pending, set `attempts` and `next_attempt_at`, and still return 200. If the insert fails, return an error and do not dispatch. Verify `tests/stripe-webhook.service.test.js` covers failed dispatch, duplicate delivery, and insert failure.
- [x] 2.2 Map admin webhook list items to `pending`, `failed`, or `processed` and return the stored `attempts`. Verify `tests/admin-billing` or the webhook repository test that a row with only an insert is not `processed`.

## 3. Mail claim retry

- [x] 3.1 On SMTP throw, keep `sent_at` null and increment `attempts`. Add a resend function that selects unsent, unexhausted claims older than 2 minutes, sends at most 20 per tick, and calls SMTP without a second claim insert. Verify `tests/transactional-mailer.test.js` for one retry, no second send after `sent_at`, stop after 5 attempts, the 20-claim cap, and that the fifth failure is logged as exhausted rather than failed.
- [x] 3.2 Confirm OTP and invite mailers are not called from the resend selection. Verify by a test or assertion that the resend query filters to the four transactional templates only.

## 4. Scheduler

- [x] 4.1 Add a scheduler module that runs one tick per job behind `GET_LOCK` on a dedicated connection, releases the lock in `finally` when the tick function returns, and catches errors per job. Do not add a timer that releases the lock early. Verify a unit test that a held lock skips the job body, a thrown body does not reject the loop, and the tick log includes the job name and a duration.
- [x] 4.2 Branch `src/index.js`: `MODE=http` without `ENABLE_BACKGROUND_JOBS` only listens; `MODE=cron` and `MODE=worker` run the scheduler and do not listen; `MODE=all` and `ENABLE_BACKGROUND_JOBS=true` do both. Verify a bootstrap test with mocked `listen` for those four cases.
- [x] 4.3 Register `eden_job_last_success_timestamp` and `eden_job_items_failed_total` on the existing prom-client registry. Verify a test that a failed item increments the counter and `/metrics` still responds.

## 5. Jobs

- [x] 5.1 Webhook retry tick: load up to 20 pending events due now, `events.retrieve` by account, dispatch, mark processed or schedule the next attempt, stop at 8 attempts or 24 hours. Verify service tests for success, terminal Stripe miss, and the attempt cap. Timeout 30s per event.
- [x] 5.2 Reconcile tick: page 50 subscriptions after the cursor, upsert status and period fields only, advance the cursor even when one retrieve fails, wrap the cursor at the end. Verify no Stripe write methods are called, a production cycle status is untouched, and a failed id is not read again until the wrap. Hourly interval. Leave the admin reconcile POST reading at most the first 100 rows.
- [x] 5.3 UPS tick: up to 20 shipments with tracking that are not delivered or voided, call track, leave the previous payload on failure. Cap one call at `min(10s, UPS_HTTP_TIMEOUT_MS)`. Verify a test that delivered and voided rows are not passed to the client, that a 5s client timeout stops at 5s, and that a 20s client timeout still stops at 10s. Interval 30 minutes.
- [x] 5.4 Refresh cleanup job under lock `eden_job_refresh_cleanup`: call `deleteExpired` for refresh tokens on a 24h cadence. Verify a repository test that expired rows are deleted and unexpired rows remain, and that this job does not take `eden_job_webhook_retention`.
- [x] 5.5 Webhook retention job under lock `eden_job_webhook_retention`: delete processed webhook events older than 90 days, never pending or failed, on a 24h cadence. Verify a repository test for that delete, and that this job does not take `eden_job_refresh_cleanup`.

## 6. Wiring and QA compose

- [x] 6.1 Document `MODE` and `ENABLE_BACKGROUND_JOBS` in `.env.example` without changing the default `MODE=http`. Add a cron service to the QA compose that sets `MODE=cron` and does not publish the API port. Verify the compose file parses, the API service still has `MODE=http`, and the API service does not set `ENABLE_BACKGROUND_JOBS`.
- [x] 6.2 Run the related Jest files only: webhook service, transactional mailer, the new scheduler and job tests, and the migration tests. Verify they pass with `npx jest --runTestsByPath` on those files.
