# Tasks

## 1. Filtro de prontos na fila

- [x] 1.1 Add `readyOnly` to `listPaidCourierCycles` and `countPaidCourierCyclesToDispatch`, appending `q.production_status = 'ready'` only when it is true, and verify `npx jest tests/subscription-ledger.courier.test.js` covers a ready cycle listed, a `in_production` cycle omitted, and the unfiltered call still returning both.
- [x] 1.2 Parse `preparo` in `listQueue` (`prontos` or omitted → `readyOnly: true`, `todos` → false, anything else → `400 invalid_preparo`), echo `preparo` on the queue, and pass `readyOnly: true` on the later count. Verify `npx jest tests/courier-delivery.service.test.js` for the default list, `preparo=todos`, the invalid value, and that out-for-delivery rows do not depend on `preparo`.

## 2. Conta do Hoje

- [x] 2.1 Pass `readyOnly: true` into both `countPaidCourierCyclesToDispatch` calls that fill `courierToDispatch` and `courierAwaitingNfe`. Verify `npx jest tests/courier-delivery.service.test.js` and `npx jest tests/admin-today.service.test.js` show a `ready` cycle counted, an `in_production` cycle in neither count, and `courierAwaitingNfe` still a subset of the ready count when the lock is on and `null` when it is off.

## 3. Fatura na fila de produção

- [x] 3.1 Copy `paidInvoiceId` through `presentProductionQueueItem`, null when the row has none. Verify `npx jest tests/production-queue-presenter.test.js` for a paid cycle (`in_123`) and an unpaid cycle (`null`). Do not add the field to Today items: `tests/admin-today.service.test.js` still expects items without `paidInvoiceId`.
