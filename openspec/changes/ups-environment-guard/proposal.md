# Proposal

## Why

The same UPS client id and secret work on CIE (`https://wwwcie.ups.com`) and on production (`https://onlinetools.ups.com`). Before this change `UPS_ENV` was read on its own. Local accepted `UPS_ENV=production`, and a test required that. QA runs with `NODE_ENV=production`, and its boot check accepted `production` or `cie`. One wrong line in a local or QA `.env` would buy real labels.

Label purchase also had no guard against a second charge. A timeout or network error on `POST /api/shipments/v2409/ship` deleted the pending row even when UPS may have bought the label. The next click bought another one. Two concurrent requests for the same invoice could both buy a label, because `stripe_invoice_id` had no unique key.

## What Changes

- **BREAKING:** `EDEN_RUNTIME` picks the UPS host. `local` and `qa` resolve to `cie`. There `UPS_ENV` may be empty or `cie`, and any other value stops the boot. `production` requires `UPS_ENV=production`, and a blank value or `cie` stops the boot. `UpsClient` repeats the check when it is built, and its base URL cannot change afterwards.
- The OAuth token cache is tied to the base URL. A 401 drops the token. Rate, track and void retry once with a new token. Ship does not.
- One shipment per invoice that is not voided, enforced by a unique key on a stored generated column (migration `1700000000030`).
- When UPS does not confirm a label, the row becomes `unknown` instead of being deleted. A `pending` or `unknown` row without a UPS id blocks new purchases for that invoice until an operator closes it with `confirm_not_created`.
- UPS error details keep the status and UPS error code. They no longer carry the UPS response body. A stored label is removed from `raw_response`.
- Tracking failures are logged. `transId` is a random 32-character id. The logger redacts the UPS secret, tokens and outbound `Authorization` headers.

## Capabilities

### New Capabilities

- `ups-shipments`: label purchase idempotency, unknown outcomes, operator resolution, UPS error details, and token renewal.

### Modified Capabilities

- `production-readiness`: "UPS environment is explicit" now follows `EDEN_RUNTIME` instead of `NODE_ENV`.

## Impact

- Edited: `src/config/env.js`, `src/infrastructure/shipping/ups-client.js`, `src/index.js`, `src/services/ups-shipment.service.js`, `src/infrastructure/repositories/ups-shipment.repository.js`, `src/api/routes/admin.routes.js`, `src/services/background-jobs.service.js`, `src/core/logger.js`, `src/infrastructure/db.js`, `.env.example`, `.env.qa.example`, `docs/production-go-live.md`.
- New: migration `1700000000030-add-ups-shipments-active-invoice-unique.js`, `tests/ups-client.test.js`, `tests/ups-shipment.repository.test.js`, `tests/integration/ups-shipments-active-invoice.migration.integration.test.js`.
- Admin panel (separate repo): `status` can now be `unknown`, the create route can answer `502 ups_shipment_unknown` and `409 ups_shipment_unresolved`, and void accepts `{"confirm_not_created": true}`. The panel does not send that flag yet.
- A QA host whose `.env` has `UPS_ENV=production` stops at boot after deploy. That is intended.
