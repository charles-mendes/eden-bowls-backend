# Design

## Context

See `proposal.md`. The courier list and the Hoje count already share `countPaidCourierCyclesToDispatch` and `listPaidCourierCycles`. A paid cycle's `paid_invoice_id` is already on the ledger row (`mapQueueRow`); `presentProductionQueueItem` drops it when it builds the production queue item.

## Goals / Non-Goals

**Goals:**

- The default "A despachar" cut of 200 applies to cycles with production status `ready`, not to every paid cycle.
- Hoje's to-dispatch count uses that same predicate, including the NF-e subset.
- The production queue item exposes the invoice id the ledger already has.

**Non-Goals:**

- A batch delivered endpoint. The panel calls the existing delivered action once per row.
- Changing `confirm_not_ready`, the address lock, or the default of `COURIER_REQUIRE_AUTHORIZED_NFE`.
- A margin report over `cost_minor`.

## Decisions

### The ready filter is a flag the service turns on

The repository methods gain `readyOnly`. When true, the WHERE adds `q.production_status = 'ready'`. The paid branch of `queueSourceSql` stores `c.status` as-is, so a null status is not `ready` and stays out, which matches the spec. `listPaidCourierCycles`, the `later` count and both Hoje counts (`courierToDispatch` and `courierAwaitingNfe`) get the flag from the service. `preparo=todos` passes `readyOnly: false`. Callers and tests that hit the repository directly keep today's meaning until they pass the flag.

Alternative: filter in the service after the query. Rejected, because the 200-row cap would fill with cycles still in the kitchen and drop ready ones.

### `preparo` is parsed next to the delivery range

`listQueue` accepts `prontos` (and a missing value) or `todos`, and rejects anything else with `400 invalid_preparo` before the range query. The response echoes `preparo`. Out for delivery, failed and delivered are loaded as today; the flag does not touch them.

### The presenter copies `paidInvoiceId`

No new column and no new query. `presentProductionQueueItem` copies `paidInvoiceId` from the row, null when absent. Unpaid cycles already come through with a null `paid_invoice_id`.

## Risks / Trade-offs

- [API deployed without the panel] → "A despachar" hides cycles that are not ready and the old panel has no "Mostrar todos". Deploy the panel in the same release, or the panel first: an old API ignores `preparo` and the list stays as today until the API ships.
- [Integration tests call the repository without the flag] → they keep asserting the unfiltered count. Service tests must expect `readyOnly: true` on the queue, the later count and Hoje.

## Migration Plan

Ship the panel and this API in one release. Rollback is reverting both. No data migration. The fiscal-lock variable stays off unless production already sets it.

## Open Questions

None. The three choices that would change the spec are already fixed: the default list is ready-only, Hoje counts only `ready`, and the invoice id is the handoff key.
