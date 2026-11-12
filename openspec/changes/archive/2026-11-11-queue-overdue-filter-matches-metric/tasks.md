# Tasks

## 1. Backend: `due=overdue` lists what the overdue metric counts

- [x] 1.1 In the production queue membership rule (`queueMembership`, subscription ledger repository), append `production_status <> 'ready'` when `due` is `overdue` and no `productionStatus` is asked. Verify with a unit test in `tests/subscription-ledger.repository.test.js` asserting the clause is present for `due: 'overdue'`, absent for `due: 'overdue', productionStatus: 'ready'`, and absent without `due`.
- [x] 1.2 Confirm Today, pack stock and the courier queue never pass `due` to the queue read (they read with `includeOverdue: true` and no due bucket), so their counts do not move. Verify with `npx jest --runTestsByPath tests/admin-today.service.test.js tests/admin-production.service.test.js tests/admin-production.routes.test.js tests/stock-metrics.test.js tests/courier-delivery.service.test.js`.
- [x] 1.3 Extend the MySQL integration test "keeps a ready Brazil cycle past its day until its box leaves" (`tests/integration/subscription-ledger-queue.integration.test.js`) with `due: 'overdue'` (kept `ready` cycle absent, paid cycle in the kitchen present) and `due: 'overdue', productionStatus: 'ready'` (kept `ready` cycle present). Verify with `RUN_DB_INTEGRATION_TESTS=true npx jest --runTestsByPath tests/integration/subscription-ledger-queue.integration.test.js` when a test database is available; otherwise record that it was not run.

## 2. Panel (`eden-bowls-admin`)

- [x] 2.1 Apply the panel's paired change `queue-overdue-filter-matches-metric` (notice after marking ready under `prazo=atrasados`, updated queue test). Verify its `tasks.md` is fully checked.

## 3. Specs

- [x] 3.1 Validate with `openspec validate queue-overdue-filter-matches-metric --strict` here and in `eden-bowls-admin`; archive both changes together so `courier-delivery` and `operations/production-queue` are synced at once.
