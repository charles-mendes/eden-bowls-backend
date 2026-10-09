# Design

## UPS host from the runtime label

`parseEnv` already requires `EDEN_RUNTIME` to be `local`, `qa`, or `production`. `NODE_ENV` cannot pick the UPS host, because QA runs with `NODE_ENV=production`. `resolveUpsEnv` in `src/config/env.js` runs right after `assertEdenRuntime`, for every `NODE_ENV`:

| `EDEN_RUNTIME` | `UPS_ENV` | Result |
|---|---|---|
| `local`, `qa` | unset, blank, `cie` (any case) | `cie` |
| `local`, `qa` | anything else | throw |
| `production` | `production` (any case) | `production` |
| `production` | anything else, including unset | throw |

The old check in `assertProductionEnv` is removed. There is no opt-in for CIE in production.

`UpsClient` takes `runtime` and runs the same rule in `resolveUpsTarget`. A client built without a runtime can only reach CIE. `envName` and `baseUrl` are non-writable own properties set in the constructor, so a later assignment throws in strict mode and is ignored otherwise.

The token cache stores the base URL it came from and is reused only for that URL. Each process has one client, so this is defense in depth.

## Label idempotency

MySQL has no partial index. `active_invoice_id` is `VARCHAR(191) GENERATED ALWAYS AS (CASE WHEN status = 'voided' THEN NULL ELSE stripe_invoice_id END) STORED`, with `UNIQUE` index `uq_ups_shipments_active_invoice`. A unique index allows several NULLs, so any number of voided rows can share an invoice. The migration stops when an invoice already has two rows that are not voided, and it does not delete data. It checks the index through `information_schema.STATISTICS`, not `queryRunner.getTable()`. On a table with a generated column added by raw SQL, `getTable()` reads `typeorm_metadata`, which does not exist.

`insertPending` returns `null` on `ER_DUP_ENTRY`. The service then reads the winner. A row with a UPS id is returned as reused. A row without one answers `409 ups_shipment_unresolved`.

The ship call is classified like this:

- UPS cannot have bought a label: the error has `stage: 'oauth'` (token step), `ups_not_configured`, or `ups_upstream_error` with a 4xx status. The pending row is deleted and the error is rethrown.
- Anything else (timeout, network error, 5xx, `ups_ship_incomplete`, an error that is not from UPS): the row moves to `unknown`, the error is logged without the payload, and the route answers `502 ups_shipment_unknown`.

After UPS returns a label, the row is never deleted. A failed label-file write is logged, and the response is saved with the image so the label can still be recovered. A failed `markCreated` is logged with the UPS shipment id and rethrown, so the pending row stays and blocks a second purchase.

`findActiveByInvoiceId` now matches `status <> 'voided'`, the same rule as the generated column. Before, a `pending` row without a UPS id went on to call ship again.

## Resolution

`POST /api/v1/admin/shipments/:id/void` on a `pending` or `unknown` row without a UPS id answers `409` unless the body has `confirm_not_created: true`. With it, the row is marked `voided` locally, UPS is not called, and the response has `local_only: true`. The operator checks the UPS account first and voids any label there. Void with a UPS id is unchanged.

## Token renewal

`request` builds the auth headers itself. On a 401 it clears the cache. Rate, track and void then send once more with a new token. Ship passes `retryOnUnauthorized: false`. A 401 on ship is a 4xx, so the pending row is deleted and the operator can click again.

## Error details

`ups_upstream_error` and `ups_oauth_failed` details are `{ code, status, ups_code? }`, plus `stage: 'oauth'` for the token step. `ups_ship_incomplete` is `{ code }`. The UPS body is never in `details`, because `app.js` and the shipping routes return `details` to the caller.

## Tests

All UPS calls in tests go through `fetchImpl` fakes. `tests/ups-client.test.js` builds the client from `parseEnv` for local and QA (with `UPS_ENV` unset and with `cie`) and checks that every OAuth, rate, ship, track and void URL starts with `https://wwwcie.ups.com/`. Production is the only case that reaches `https://onlinetools.ups.com`.
