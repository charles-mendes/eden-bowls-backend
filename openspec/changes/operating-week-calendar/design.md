# Design

## Context

- The preparation week is code: `brazilPrepValid` (any day but Sunday) and `usPrepValid` (Monday–Friday, plus a weekday UPS pickup the next day and a weekday delivery) in `src/core/delivery-closed-days.js`. A US Friday is never a preparation day today, because its pickup would fall on Saturday.
- `firstPrepDay(market, moment, rows, transitDays)` returns the first valid day whose local midnight is at or after `moment`. Every delivery date goes through it: `projectOne` (customer's deliveries, skip and postpone offers, calendar impact), `DeliveryEstimator` (checkout estimate, paid cycles, order email), and `planBlockTrialEnd`.
- Renewals are charged on Stripe's natural anchor, at the time of the original purchase (for example 14:30). Only a skip, postpone or calendar move sets `trial_end` to 00:00 local of the preparation day. The paid cycle takes its preparation day from the invoice `paid_at`. Stripe usually pays some minutes after the charge, so today a 00:00 charge reaches the queue a day after the customer's projection. The hours rule puts both on the charge day.
- Closed days are read from the database on each use (`calendar.listActive()`), at six call sites: `customer-deliveries`, `delivery-estimator`, `delivery-calendar-impact` (via `admin-delivery-calendar`), `admin-today`, `ups-pickup`, `admin-delivery-calendar`.
- Closed-day writes already preview the impact, refuse over locked deliveries, queue Stripe syncs (`delivery_calendar_stripe_syncs`) and audit as `delivery_calendar.*`. The history query filters by `metadata.closedOn` year.

## Goals / Non-Goals

**Goals:**
- One source for "is this a preparation day" and "which day does this payment prepare", reading the week and the closed days together, so every date agrees.
- Reuse the closed-day impact, Stripe sync and audit machinery for a week change.

**Non-Goals:**
- Hours for pickup or delivery, or weekly rules per activity (pickup, delivery). Exceptions by date stay in closed days.
- A separate cutoff earlier than closing time (for example "orders until 18:00").

## Decisions

**Storage: one row per market and weekday.** Table `delivery_operating_week` (`market`, `weekday` 1–7 with Monday = 1, `open`, `opens_at` TIME, `closes_at` TIME, `updated_at`), unique on (`market`, `weekday`). The migration seeds BR Monday–Saturday and US Monday–Friday open 09:00–20:00, the other days closed. Alternative: a JSON column in a settings table. Rejected because rows give per-day validation and a simple audit diff.

**The calendar is read as one snapshot `{ rows, week }`.** The repository gains `snapshot(executor)`, returning the active closed days and both weeks in one read. The core validity and projection functions take that snapshot where they take `rows` today, so the week travels with the closed days through `projectOne`, `offerDates`, `planBlockTrialEnd` and the impact assessment. Alternative: process-wide state set at boot and on save, the way the Brazil delivery days and radius work. Rejected because closed days are already read per request, and a second API process would keep an old week until restart.

**Preparation validity.** `brazilPrepValid` = the weekday is open for BR and no row closes preparation. `usPrepValid` = the weekday is open for US, plus the existing pickup and delivery checks, unchanged. The hard-coded "not Sunday" and "Monday–Friday" checks are removed; the seed reproduces them.

**Payment to preparation day.** `firstPrepDay` checks the moment's local date first: it qualifies when it is a preparation day and the local time is before that weekday's `closes_at`. Otherwise the scan continues from the next date, as today, up to 21 days. This replaces "local midnight at or after the moment". A scheduled charge at 00:00 stays on its day. The `midnight + 1s` lookup in `planBlockTrialEnd` (original day no longer valid) still lands on the next valid day, because the original day fails validity.

**Week change impact = projection before vs after.** Renewals are charged at the time of the original purchase, so the hours and an opened weekday move them too, earlier or later. For each scheduled delivery, the impact projects the preparation day from its charge under the stored snapshot and under the proposed one, which differ only in the week, and lists those that differ. Closed-day writes keep their validity check (`assessImpact`), since a closure only removes days.

**Outcome per affected delivery instead of refusing over locked ones.** Closed-day writes refuse with `delivery_locked`, which suits closing one date. A week change reaches every future week, and a single locked delivery would block it. Each affected delivery gets an outcome instead:
- `kept`: paid, in production, ready or blocked. Its stored date stays.
- `moved_charge_kept`: unpaid and past the edit deadline (`past_editable_until`). Its date is not stored: it is projected from the charge on each read, and the paid cycle takes the preparation day from `paid_at`. With the weekday closed, every read already lands on the next open day. Stripe is not touched, so the charge stays on the day the customer was told; only preparation and delivery move.
- `moved`: unpaid and editable. When its charge sits at 00:00 of the current preparation day, a Stripe sync or pending-change rewrite moves it, as closed days do. Otherwise (a charge at the purchase time) only the projection moves and the charge stays.

No new storage is needed. The preview reports what every later read will show.

**Confirmed impact, checked at save.** The preview returns the moved deliveries. The save body carries the confirmed moves only (`deliveryId` + new preparation day); kept deliveries are left out, so a locked one never triggers a mismatch. Inside the transaction the moves are computed again. If they differ, the save returns `409 week_impact_changed` and stores nothing. This keeps "no save without seeing the impact" on the server, not only in the panel.

**Routes.** `GET /api/v1/admin/delivery-calendar/week` (`production.read`), `POST /api/v1/admin/delivery-calendar/week/preview` and `PUT /api/v1/admin/delivery-calendar/week` (`production.write`), all `market: 'query'`. They are registered before `/:id` so `week` is not read as an id. Added to `docs/api-routes.json`.

**Audit.** Action `delivery_calendar.week_update`, with metadata `{ market, before, after, impact (id, old and new preparation day, outcome), syncIds }`. `listDeliveryCalendar` includes week events by the year of `created_at`, since they have no `closedOn`.

**Panel.** `DeliveryCalendarPage` becomes "Calendário de operação", with a Semana padrão tab first (seven rows: open switch, opens, closes, plus an "i" on how hours decide the preparation day). "Ver impacto" lists each delivery with its outcome ("muda para …", "cobrança mantida, preparo muda para …", "mantém a data"), and "Salvar semana" is enabled only after a preview of the current draft. A US note explains that Friday and Saturday never prepare because the UPS pickup would fall on a weekend, while an open Sunday prepares with pickup on Monday. The menu label changes. The route `/operations/delivery-calendar` stays.

## Risks / Trade-offs

- [Orders paid inside the hours are prepared the same day; the kitchen sees them in today's queue] → This is the requested behavior. The Semana padrão tip and the release note say so. The closing time is the operator's lever.
- [Renewals paid a few minutes after 00:00 move from the next day to the charge day in the queue] → It matches what the customer already sees. Not in production yet, so there is no history to reconcile.
- [Snapshot refactor touches every date path] → Mechanical change, covered by the existing calendar, deliveries, impact and estimator suites plus new cases for the week and hours.
- [A large week change queues many Stripe syncs] → The existing sync job processes and retries them, and the panel's sync list shows delays.
- [`week` path vs `/:id` routes] → Register the week routes first, with a route test.

## Migration Plan

1. Deploy the migration (create and seed `delivery_operating_week`). The weekdays equal today's, so nothing is postponed. Renewals charged before 20:00 on an open day move one day earlier, to the charge day. Nothing is aligned in Stripe (QA only, no real customers).
2. Deploy the API and panel.
3. In the panel, the operator sets Brazil Monday–Friday 09:00–20:00, reviews the impact (Saturday deliveries) and saves.

Rollback: revert the code; the table can stay (unused) or be dropped by the migration's `down`. Deliveries already moved keep their new Stripe dates, as with closed days.
