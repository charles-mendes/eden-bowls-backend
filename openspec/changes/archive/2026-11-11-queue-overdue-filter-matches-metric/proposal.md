# Proposal

## Why

The "Atrasados" card (Dashboard and production queue) counts only late cycles the kitchen has not finished, but the card opens the queue with `prazo=atrasados`, whose `due=overdue` filter also lists the `ready` Brazil cycles kept past their day until the box leaves. The card shows 0 and the list it opens shows an order, so the operator reads it as a bug.

## What Changes

- The production queue's `due=overdue` filter lists only overdue cycles whose production status is not `ready`, the same set the overdue metric counts. **BREAKING** for any caller relying on `due=overdue` to return the kept `ready` cycles.
- With an explicit `productionStatus=ready` alongside `due=overdue`, the kept `ready` cycles are listed (the explicit status wins over the default exclusion).
- The kept `ready` Brazil cycles do not leave the queue: they keep showing in the unfiltered queue (panel group "Prontos para expedir") and under the `ready` status filter, and stay counted by the courier's "a despachar".
- Panel: marking an order ready while the "Atrasados" filter is on makes it leave the filtered list on the next read; the panel says where it went instead of letting it vanish silently. Specified and tracked by the panel's own change with the same name (`eden-bowls-admin/openspec/changes/queue-overdue-filter-matches-metric`), which modifies `operations/production-queue`.

## Capabilities

### New Capabilities

_None._

### Modified Capabilities

- `courier-delivery`: the requirement "The production queue keeps a ready Brazil order until it leaves" changes what the `due=overdue` filter lists.

## Impact

- Backend: the production queue membership filter in the subscription ledger repository; its unit and MySQL integration tests.
- API: `GET /api/v1/admin/production/queue?due=overdue` returns fewer rows (no `ready` ones unless `productionStatus=ready`). No route added, renamed or removed; the routes manifest does not change.
- Panel (`eden-bowls-admin`): its paired change replaces the scenario "Marked ready from the overdue filter" of `operations/production-queue`, adds the notice and updates the queue test. Both changes are applied and archived together, so neither repo's specs contradict the other.
- Dashboard and Today counts do not change.
