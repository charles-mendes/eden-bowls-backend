# Tasks

## 1. UPS host from the runtime

- [x] 1.1 Add `resolveUpsEnv` to `src/config/env.js` and call it after `assertEdenRuntime`. Local and QA resolve to `cie` and throw on any other `UPS_ENV`. Production requires `UPS_ENV=production`. Remove the old check from `assertProductionEnv`. Verify with `npx jest --runTestsByPath tests/env.parse.test.js`.
- [x] 1.2 Add `runtime` and `resolveUpsTarget` to `UpsClient`. Make `envName` and `baseUrl` non-writable, and key the token cache by base URL. Pass `env.EDEN_RUNTIME` from `src/index.js`. Verify the CI `config` command still passes with `EDEN_RUNTIME=qa` and `UPS_ENV=cie`, and fails with `UPS_ENV=production`.

## 2. Label idempotency

- [x] 2.1 Add migration `1700000000030` with the generated `active_invoice_id` column and the unique index `uq_ups_shipments_active_invoice`. Stop when an invoice has two active rows. Register it in `src/infrastructure/db.js`. Verify with `npx jest --runTestsByPath tests/ups-shipment.repository.test.js` and, against MySQL, `RUN_DB_INTEGRATION_TESTS=true npx jest --runTestsByPath tests/integration/ups-shipments-active-invoice.migration.integration.test.js` (five concurrent inserts leave one active row, voided rows do not count, `down` and the duplicate refusal work).
- [x] 2.2 `findActiveByInvoiceId` matches `status <> 'voided'`. `insertPending` returns `null` on `ER_DUP_ENTRY`. Add `markUnknown`.
- [x] 2.3 In `UpsShipmentService.createForSubscription`, block `pending` or `unknown` rows without a UPS id, mark ambiguous ship failures `unknown`, delete the pending row only on token or 4xx failures, and never delete the row after UPS returns a label.
- [x] 2.4 Let void close a `pending` or `unknown` row without a UPS id only with `confirm_not_created: true`, and pass that flag from `POST /api/v1/admin/shipments/:id/void`. Verify with `npx jest --runTestsByPath tests/ups-shipment.service.test.js`.

## 3. Tests

- [x] 3.1 Replace the test that kept `UPS_ENV=production` outside production. Add cases for local and QA (unset, blank, `cie`, `production`, unknown) and for production (`production`, `cie`, blank, unset).
- [x] 3.2 Add `tests/ups-client.test.js`. Using only `fetchImpl` fakes, prove that local and QA send every OAuth, rate, ship, track and void call to `https://wwwcie.ups.com/` and that only production reaches `https://onlinetools.ups.com`.

## 4. Robustness and logs

- [x] 4.1 On a 401, drop the token and retry rate, track and void once. Do not retry ship.
- [x] 4.2 Remove the UPS body from error details. Strip label images from a stored `raw_response`. Log tracking failures in `runUpsTracking`. Use a random 32-character `transId`.
- [x] 4.3 Redact `UPS_CLIENT_SECRET`, `clientSecret`, `access_token`, `accessToken`, and `headers.Authorization` in `src/core/logger.js`.

## 5. Docs

- [x] 5.1 Update `.env.example`, `.env.qa.example`, and the UPS section of `docs/production-go-live.md` with the runtime table, the migration precondition, and how to close an unknown row. Do not write any credential.
- [ ] 5.2 On the QA host, confirm `.env` has `EDEN_RUNTIME=qa` and `UPS_ENV` empty or `cie`, and that no invoice has two `ups_shipments` rows that are not voided, before deploying this change. Do not print secrets.
- [ ] 5.3 In the admin panel repo, show `unknown` rows and offer the confirmed close (`confirm_not_created: true`) after the operator checks UPS.
