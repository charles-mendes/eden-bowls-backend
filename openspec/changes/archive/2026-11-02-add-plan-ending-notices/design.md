# Design

## Context

See proposal.md for motivation and the delta specs for requirements.

- Stripe's period end is the charge date. With renewal on, a plan charges monthly and rolls into a new contract after its term.
- With renewal off, `cancel_at_period_end` is set only when the last contracted delivery is charged (`endContractAfterLastDelivery`). Until then the plan is not ending yet, so the ledger flag alone identifies the contract's final period.
- `auto_renew` is stored separately from `cancel_at_period_end`. An explicit cancel leaves `auto_renew` as it was.
- `claimMailSend` deduplicates by subscription, template, and reference. `sendClaimed` releases the claim on failure.
- `mail_resend` covers four named templates only, and this change does not extend it.

## Goals / Non-Goals

**Goals:**

- One rule decides who qualifies, shared by the email and the banner.

**Non-Goals:**

- Fixing `charged_deliveries` after a term change or defining plan extension. Those belong to the contract lifecycle spec.
- SMS, push, or a customer opt-out for these notices.
- Admin screens listing sent notices.

## Decisions

### One pure rule in `src/core/plan-notice.js`

`planNoticeFor(row, { now, noticeDays })` returns `{ kind, date, daysLeft, emailable }` or null. The job and both dashboard reads call it. `emailable` is false for an explicit cancellation, which keeps the banner and blocks the email. Separate logic in the job and the dashboard would drift. The rule accepts only `now <= period end <= now + noticeDays`. `row.autoRenew === false` is required for the ending email, because `resolveAutoRenew` reads a null value as off and would email customers who cancelled.

### Contract boundary comes from `chargedDeliveries`

The next charge starts a contract when `chargedDeliveries % term === 0` and the count is above zero. A one-month term with a null count also qualifies, because every charge after the first is a renewal. A stored 0 does not qualify on any term. A longer term with a null count returns null, because guessing could announce a renewal that is only an instalment.

### Reference is the period end

The claim reference is `<template>:<period end unix seconds>`, with templates `renewal_notice` and `plan_ending_notice`. A skip that moves the period end produces a new reference without extra state, and a new table is unnecessary.

### Hourly job with a claim check, not a daily one

The job reads candidates through a new ledger query bounded by period end and status, ordered by period end, with no row limit. The window bounds the result, and a SQL limit would let notified rows hide later ones. The job walks the rows until it has sent 100. Hourly ticks fit that cap and retry failed sends without extending `mail_resend`. Claims make repeat ticks cheap, and a duplicate does not consume the cap. The claim check runs before the Stripe preview, so a repeat tick costs no Stripe read. This needs a read-only lookup by subscription, template, and reference on the claims repository, because `sendClaimed` claims only at send time and `hasSentClaim` ignores the reference. `sendClaimed` returns `failed: true` instead of throwing, so the job reads that result as well as catching exceptions.

### Amount from a Stripe invoice preview

A new `previewUpcomingInvoice(subscriptionId)` calls `invoices.createPreview` with only the subscription id and a timeout of 15 seconds. It runs for renewal notices only. `amount_due` and `currency` go through the existing `formatMoney`. The ledger subtotal ignores coupons and shipping, so it could state the wrong amount. On failure the letter omits the amount, because a late notice is worse than one without a price.

### Settings extend the existing row

Three columns are added to `automated_email_settings` with raw SQL guarded by `information_schema`, the same approach as migration 059, with defaults on, on, 7. The endpoint and audit action stay the same, so the route manifest does not change.

### Banner reads the window from settings

The list and detail reads load the market settings once per request and pass `noticeDays`. The email switches do not affect the banner. `plan_notice.date` is the exact period end, not `toIsoDate`, so the store can format it in the zone `formatLetterDate` uses and match the letter.

## Risks / Trade-offs

- [A plan changed to another term keeps its `charged_deliveries`, so the boundary can be wrong] → Accepted until the contract lifecycle spec, which must reuse `planNoticeFor`.
- [A customer who turns renewal off inside the window gets the auto-renew-off letter and a plan-ending notice shortly after] → Accepted, since it is rare and the second letter carries the end date.
- [SMTP down for long periods retries every hour] → Bounded by the window, and logged as failed. Claims are released, not exhausted.
- [A process dying between the claim and the send leaves an unsent claim that blocks that notice, and `mail_resend` does not cover these templates] → Accepted, since the banner still shows and the window is short.
- [Local Stripe keys are identical, so webhooks process twice] → No effect here, because the job does not depend on webhooks and claims deduplicate sends.

## Migration Plan

Deploy the backend first with the migration, then the panel, then the store. A panel older than the backend fails on save with 422 during that gap. Rollback: disable both switches per market; the extra columns are harmless.

## Open Questions

- Whether the 7-day default meets the notice rules for auto-renewal in each market. The window is configurable, so a legal answer changes only a setting. The first tick inside the window can fall up to an hour short of 7 full days, so a rule of at least 7 full days needs the setting at 8.
