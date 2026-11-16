# Proposal

## Why

Customers hear nothing before a contract renews or ends. Today the only letters arrive after a charge, when renewal is turned off, and when the plan is cancelled, so a renewal can surprise the customer and a plan can stop with no reminder.

## What Changes

- Send a renewal notice before the charge that starts a new contract, when automatic renewal is on.
- Send a plan-ending notice before a contract ends, when automatic renewal is off.
- Show the same notice as a banner in Meu Plano and on the plan detail page.
- Expose the notice state on the customer subscription list and detail payloads.
- Add per-market switches and a notice window to the automated email settings in the admin. **BREAKING** for clients of the settings endpoint: saving now requires the three new fields. The panel is the only client and changes with this work.
- Add a scheduled job that sends both notices, with PT and EN letters.

## Capabilities

### New Capabilities

- `plan-notices`: When a customer is told that a contract will renew or end, through which channels, and what the notice says.

### Modified Capabilities

- `automated-email-settings`: Adds per-market switches and the notice window for plan notices.
- `background-jobs`: Adds the scheduled tick that sends plan notices.

## Impact

- Backend: `src/core/automated-email-settings.js`, a new migration, `src/core/email/transactional-emails.js`, `src/core/email/preview-fixtures.js`, `src/infrastructure/mailers/transactional-mailer.js`, `src/infrastructure/repositories/subscription-ledger.repository.js`, `src/infrastructure/repositories/subscriptions.repository.js`, `src/infrastructure/repositories/subscriptions-detail.repository.js`, `src/services/background-jobs.service.js`, `src/infrastructure/stripe/stripe-billing-client.js`.
- Panel (`eden-bowls-admin`): `src/lib/adminSettings.ts`, `src/pages/SettingsPage.tsx`.
- Store (`eden-bowls`): `src/services/onboardingApi.ts`, `src/pages/dashboard/pages/MyPlan.tsx`, `src/pages/dashboard/pages/PlanDetail.tsx`, i18n texts.
- Stripe: one read-only invoice preview per renewal notice. No charge, price, or subscription change.
- No route is added, renamed, or removed, so the route manifest stays as it is.
