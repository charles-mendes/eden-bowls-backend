# Design

## Context

The production queue's rows and its metrics come from separate reads. The rows read (`listQueue`) builds its WHERE from one membership rule: the window, plus, when overdue cycles are included, the overdue cycles not `ready` and the kept `ready` Brazil cycles (keep-ready-orders-dispatchable). The `due` filter only narrows that set by date: `due=overdue` means "preparation day before today", so it returns both kinds. The metrics read applies no `due` filter and drops `ready` from `overdue` in the service. Asking for `due=overdue` already forces `includeOverdue` on.

The panel groups a `ready` overdue row under "Prontos para expedir" and reloads the queue after any status change, so a row that stops matching the active filter disappears on that reload.

## Goals / Non-Goals

**Goals:**

- `due=overdue` returns exactly the cycles the overdue metric counts.
- The kept `ready` cycles stay reachable: no due filter, `productionStatus=ready`, and `due=overdue` + `productionStatus=ready`.
- In the panel, an order marked ready under the "Atrasados" filter does not vanish without a word.

**Non-Goals:**

- Changing which cycles the queue keeps, the 30-day floor, the courier's "a despachar" count, or Today's counts.
- A new due bucket or a new "prontos atrasados" filter value.

## Decisions

- **Exclude `ready` in the membership rule, only for `due=overdue` without a status filter.** The membership query appends `production_status <> 'ready'` when `due` is `overdue` and no `productionStatus` was asked. An explicit status filter already narrows the rows to one status, so it wins: `due=overdue&productionStatus=ready` keeps returning the kept `ready` cycles.
  - Alternative: drop the `ready` rows in the service after the read. Rejected: pagination and `total` come from SQL, so a post-filter would return short pages and a wrong total.
  - Alternative: remove the kept `ready` cycles from the overdue range entirely. Rejected: the unfiltered queue and the `ready` filter must still show them with Expedir.
- **Panel notice after marking ready under "Atrasados" (specified in the panel's paired change).** When the queue is filtered by `prazo=atrasados` and a single or batch status change sets `ready`, the panel shows an info notice saying the order left Atrasados and waits in "Prontos para expedir", with a link to the queue filtered by status Pronto (keeping the market filter). Nothing else in the panel changes: the card hints already say ready orders are not counted.
  - Alternative: keep the row visible locally until the next manual reload. Rejected: the queue reloads after every change by design, and a stale row would show a filter result the API no longer returns.

## Risks / Trade-offs

- [A caller relied on `due=overdue` to find ready orders waiting to leave] → The only callers are the panel queue and its links (Dashboard cards, Today pending items, stale paid item). The stale paid cycles are not `ready`, so their link keeps listing them. The courier screen reads its own queue, not this filter.
- [Operators used "Atrasados" to find ready orders to dispatch] → The notice and the existing "Prontos para expedir" group without a filter, the `ready` status filter, and the courier's "a despachar" all point to them.

## Migration Plan

No data change. Deploy the backend and panel together. Rollback is reverting the commits; no state depends on it.
