# Tasks

## 1. Settings

- [x] 1.1 Add migration 060 with the three columns on `automated_email_settings` and register it in `src/infrastructure/db.js`; verify with a new migration test and by applying it locally.
- [x] 1.2 Extend `src/core/automated-email-settings.js`, its repository, and service with the three fields; verify `tests/automated-email-settings.routes.test.js` covers the 422 for 31 days, for missing fields, and the audit entry.
- [x] 1.3 In `eden-bowls-admin`, add the two switches and the window to `src/lib/adminSettings.ts` and `src/pages/SettingsPage.tsx`; verify with `npx vitest run src/pages/SettingsPage.test.tsx`.

## 2. Notice rule

- [x] 2.1 Create `src/core/plan-notice.js` with `planNoticeFor`; verify with a new `tests/plan-notice.test.js` covering every scenario of the renewal, ending, and outside-window rules, including a one-month plan with a null count and with 0, a three-month plan with a null count, a past period end, a stored `auto_renew` of true or null with cancel at period end, and `days_left` never negative.

## 3. Letters

- [x] 3.1 Add `buildRenewalNoticeEmail` and `buildPlanEndingNoticeEmail` in PT and EN and add them to `src/core/email/preview-fixtures.js`; verify with the transactional email tests, with and without an amount.
- [x] 3.2 Add `notifyRenewalNotice` and `notifyPlanEndingNotice` to the mailer with the two new templates; verify a mailer test shows a duplicate reference does not call SMTP and an SMTP failure returns `failed: true` with the claim released.

## 4. Job

- [x] 4.1 Add the ledger candidates query and the claims lookup; verify with repository tests for the bounds, order, and statuses, that the query has no row limit, and that the lookup matches on the reference.
- [x] 4.2 Add `previewUpcomingInvoice` to the Stripe billing client; verify with a test that the call sends only the subscription id and that a Stripe error and a timeout both reach the caller.
- [x] 4.3 Add the `plan_notices` job with its lock, interval, per-market settings, 100-per-tick cap, and counts; verify with a new `tests/background-jobs.plan-notices.test.js` covering the switches, the cap with 100 already-notified rows ahead of a qualifying one, a `failed: true` mailer result counted as failed, a failed preview sent without an amount, no preview on ending notices, and a moved period end.
- [x] 4.4 Add the job to `docs/` where background jobs are listed, if they are; verify with `rg "ups_tracking" docs`.

## 5. Dashboard

- [x] 5.1 Return `plan_notice` from the list and detail reads, loading the market window once per request; verify with the subscription route tests, including that the email switch off keeps it and that no Stripe call is made.
- [x] 5.2 In `eden-bowls`, add the type and a shared banner to `MyPlan.tsx` and `PlanDetail.tsx` with PT and EN texts, the date in the market's time zone, and an ending banner that states only the date; verify with `npx vitest run src/pages/dashboard/pages/MyPlan.test.tsx src/pages/dashboard/pages/PlanDetail.test.tsx`.

## 6. Integration

- [x] 6.1 With a local test subscription and `MODE=all`, confirm one renewal notice and one ending notice arrive, a second tick sends nothing, and the banner shows in the store.
- [x] 6.2 Run `npx jest --changedSince=main` in the backend, and the related Vitest files in the panel and store.
