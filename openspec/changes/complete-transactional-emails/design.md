# Design

## Context

See proposal.md for why. The mail path that already works is `createTransactionalMailer` → `sendClaimed` → `subscription_mail_claims` → `otpMailer.sendMail`. Templates for renewal, pause, resume, cancel, and plan change live in `src/core/email/transactional-emails.js` and are only referenced by `preview-fixtures.js`.

`invoice.paid` with `billing_reason = subscription_create` sends `order_confirmed` and `admin_new_subscription`, and returns early when the invoice promotes a pending plan edit. `invoice.payment_failed` and `payment_intent.payment_failed` both call `notifyPaymentFailed`, with different reference ids (`in_` vs `pi_`), so one failure can send two letters. UPS shipment creation sends `shipped`. Pause, resume, and cancel update Stripe and wait for `customer.subscription.updated`, which only upserts the ledger. Plan commit writes the ledger and does not mail.

Webhook events are inserted before dispatch. A later Stripe delivery of the same event id returns without running dispatch. Dispatch errors are logged and the route still responds 200. A mail claim that fails SMTP stays in the table with `sent_at` null, and the next claim hits the unique key and is treated as a duplicate.

Locale is `localeFrom`: Stripe account `br` or delivery country `BR` → `pt-BR`, otherwise `en-US`.

## Goals / Non-Goals

**Goals:**

- Call the existing builders from the existing mailer, with the same claim, log, and skip rules.
- Fire each new letter from the transition that already persists the business fact.
- Make a failed send retryable inside that call, and leave a successful send claimed.

**Non-Goals:**

- New templates, a payment-approved template, ops letters beyond the first paid cycle, a Brazil shipped letter, password reset, OTP, invites, privacy mail.
- A mail queue, cron, or a change to webhook acknowledgement. The event row stays inserted even when mail fails.
- Frontend or admin API changes.

## Decisions

### 1. One mailer, five new notify methods

Add `notifyRenewal`, `notifyPaused`, `notifyResumed`, `notifyCancelled`, and `notifyPlanChanged` on `createTransactionalMailer`. Each builds the existing template through `mail-context` (`firstNameFrom`, `petNameFrom`, `flavorsFrom`, `formatMoney`, `localeFrom`, `dashboardPlansUrl`) and calls `sendClaimed`.

Template keys: `renewal`, `paused`, `resumed`, `cancelled`, `plan_changed`.

Alternative considered: send from the store action handler before the webhook. Rejected because pause, resume, and cancel already return `pending_webhook_confirmation` and the ledger is updated only when Stripe echoes the change. Mailing from both places would double-send.

### 2. Event map

| Letter | Trigger | Where | Reference | Recipient | Market |
|---|---|---|---|---|---|
| `order_confirmed` | `invoice.paid`, `subscription_create`, not a pending plan edit | `StripeWebhookService.notifyFirstCycleMail` | invoice id | ledger email, else invoice email | pt-BR / en-US |
| `admin_new_subscription` | same first invoice | same method | invoice id | `MAIL_OPS_TO` | same locale as the subscription |
| `renewal` | `invoice.paid`, `subscription_cycle` | `handleInvoicePaid` after ledger upsert | invoice id | customer email | both |
| `payment_failed` | `invoice.payment_failed` only | `handlePaymentFailed` | invoice id | customer email | both |
| `shipped` | UPS shipment saved with tracking | `UpsShipmentService.notifyShippedMail` | shipment id | subscription user email | US. BR production updates do not call it |
| `paused` | `customer.subscription.updated` and `pause_collection` becomes set | `handleSubscriptionChanged` | `paused:<event id>` | customer email | both |
| `resumed` | same event and `pause_collection` is cleared | same | `resumed:<event id>` | customer email | both |
| `cancelled` | `cancel_at_period_end` becomes true | same | `cancel_scheduled:<period end>` | customer email | both |
| `cancelled` | `customer.subscription.deleted` and no sent `cancelled` claim exists | same | `deleted` | customer email | both |
| `plan_changed` | edit commit with `edit_payment_pending` false | edit-commit repository after ledger upsert | `plan:<invoice id or plan hash>` | customer email | both |
| `plan_changed` | `invoice.paid` promotes `editPending` for that invoice | `handleInvoicePaid` | invoice id | customer email | both |

`payment_intent.succeeded` and `payment_intent.payment_failed` keep updating checkout state and do not send mail.

`subscription_update` invoices do not send renewal. The pending-edit invoice sends only `plan_changed`.

Pause without `resumes_at` still uses `buildPausedEmail`. The template already prints an em dash for an empty resume date. Do not change the template.

Dates in renewal, resume, and cancel use Luxon. Brazil letters use `America/Sao_Paulo`. US letters use `America/New_York`. Format with the letter locale.

`handleSubscriptionChanged` needs `event.data.previous_attributes` and `event.id`. Compare previous pause and `cancel_at_period_end` to the new object. Ignore updates that do not cross those edges (card, period, price).

On `customer.subscription.deleted`, query whether a `cancelled` claim for that subscription already has `sent_at`. If it does, skip. That covers period-end deletion after the scheduled letter.

### 3. Retry and claims

`sendClaimed` tries `sendMail` up to 3 times in the same call, with a short delay between tries. Success calls `markSent` as today.

On final failure, delete that claim row when `sent_at` is still null (`releaseUnsent`) and log `template`, subscription id, and error code. Do not log the recipient body. The unique key then allows a later call with the same reference to insert again.

A claim that already has `sent_at` stays a duplicate and does not call SMTP.

This does not add a worker. Because the webhook event is stored before dispatch and errors are swallowed, Stripe will not re-enter the handler. The three in-process tries are the retry. Releasing the row only helps a later call that uses the same reference (a second plan commit with the same hash, or a test). That matches the spec: a failed claim is not a completed send, and the business action still succeeds.

Ops fan-out stays one claim for the invoice. Mark sent only after every ops address succeeds. If one address fails, retry the whole list, then release the claim. A retry can deliver twice to an address that already succeeded. Accepted for the ops list only.

### 4. Callers stay non-blocking

Webhook, UPS, and plan commit keep their current try/catch around mail: log and continue. Plan commit returns success even when the letter fails. Do not throw out of `sendClaimed`.

Missing subscription id, reference, or recipient returns `{ skipped: true, reason: 'missing_context' }` and logs a warning. Same as order confirmed today.

### 5. Tests

Extend the existing Jest files. Do not add a new harness.

- `tests/transactional-mailer.test.js`: each new notify sends once, duplicate claim skips SMTP, SMTP throw releases the claim and does not mark sent, three tries then release.
- `tests/stripe-webhook.service.test.js`: `subscription_cycle` calls renewal and not order confirmed; `subscription_create` stays order confirmed plus admin; promoted pending calls plan changed only; `invoice.payment_failed` mails once; `payment_intent.payment_failed` does not mail; previous attributes drive pause, resume, and cancel; deleted after a sent cancel claim does not mail.
- `tests/subscriptions-edit-commit` (the repository or service test that already covers commit): immediate commit calls plan changed; pending commit does not.
- `tests/ups-shipment.service.test.js`: keep the current shipped assertion. No new BR case beyond "production status update does not construct a shipment mailer call" if a production test already exists; otherwise assert only in the mailer that shipped still requires a tracking number.
- `tests/email-templates.test.js`: assert the five builders still return subject, text, and html for pt-BR and en-US. No snapshot of the whole HTML.

## Risks / Trade-offs

- [SMTP still down after 3 tries, and Stripe will not redeliver the event] → The letter is logged and the claim is released, but nothing calls it again. Accepted to avoid a job. The customer action and the ledger write still succeed.
- [Ops retry can duplicate one address] → One claim per invoice, mark sent only when every address succeeds. Duplicates are limited to a failed fan-out.
- [`cancel_scheduled:<period end>` sends once per period end] → Turning auto-renew off, on, and off again before the period end does not send a second letter. A new period end does.
- [Plan hash reference] → Two identical edits share one letter. A real plan change produces a new hash and a new letter.
- [Pause date is an em dash when Stripe has no `resumes_at`] → The current pause API sets `behavior: void` without a resume date. The existing template already handles an empty value.

## Migration Plan

Deploy the backend only. No migration: `subscription_mail_claims` already has the unique key and `sent_at`. Rollback is reverting the process. Sent claims remain and keep blocking duplicates. Unsent claims released by a failed attempt are already deleted.

## Open Questions

None. The Brazil shipped letter waits until a ship action with a tracking number exists.
