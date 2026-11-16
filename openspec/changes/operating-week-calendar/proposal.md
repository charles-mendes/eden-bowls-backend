# Proposal

## Why

The days and hours each market prepares orders are fixed in code: Brazil prepares every day but Sunday and the United States Monday to Friday (`brazilPrepValid`, `usPrepValid` in `src/core/delivery-closed-days.js`), and every payment counts from local midnight, so an order paid at 10:00 is prepared the next day. The operator cannot set the week the kitchen works or its hours, and every delivery date (checkout estimate, order email, production queue, the customer's deliveries) follows the hard-coded week. The operator wants to set it per market, Monday to Friday 09:00–20:00, and have dates follow.

## What Changes

- A standard week per market (`BR`, `US`): for each weekday, open or closed, and when open, an opening and a closing time in the market's time zone (`America/Sao_Paulo`, `America/New_York`).
- "Open" means preparation only. A weekday that is not open is not a preparation day. Pickup and delivery keep their rules: UPS never picks up or delivers on a weekend, and the Brazil delivery time in business days keeps skipping Saturday and Sunday. One-off exceptions by date stay in the closed days (Feriados e fechamentos).
- **BREAKING (dates of new orders):** the preparation day of a payment follows the hours. Paid on an open day before closing time (including before opening, such as a renewal charged at 00:00) → prepared that day. Paid after closing time, or on a day that is not open → the next open day. Today an order paid during the day is prepared the next day; inside the hours it becomes the same day.
- The migration stores the weekdays the code applies today (Brazil Monday–Saturday, United States Monday–Friday), each open 09:00–20:00, so no scheduled delivery is postponed on deploy. Charges at 00:00 (after a skip, postpone or calendar move) stay on their day. Renewals charged at the time of the original purchase, before closing on an open day, move one day earlier, to the charge day. Nothing is changed in Stripe; there are no real customers yet. The operator then closes Saturday in Brazil through the impact preview.
- Every change of the week (days or hours) requires an impact preview first: each scheduled delivery whose preparation day changes, later or earlier, with its new dates. Renewals are charged at the time of the original purchase, so changing only the hours or opening a day can move them too. Deliveries already paid, in production, ready or blocked keep their date ("mantém a data"). Unpaid ones past the customer's edit deadline keep their charge and move preparation and delivery. The others move. Their Stripe charge is synced only when it sits at 00:00 of the preparation day, as closed days do today; a charge at the purchase time stays, and only the preparation moves. A save whose impact changed since the preview is refused, to be previewed again.
- Every change of the week is recorded in the calendar history with who made it, before and after, and what moved.
- Admin panel: Feriados e fechamentos becomes **Calendário de operação** with the tabs Semana padrão, Feriados e fechamentos, and Histórico. Edit with `production.write`, each staff member in their own market.

## Capabilities

### New Capabilities
- `delivery-calendar`: the days and hours each market prepares orders (the standard week and the closed days that override it), how a payment becomes a preparation day, and how a change of the week is previewed, applied to scheduled deliveries, and recorded.

### Modified Capabilities
- None. No existing spec states the preparation week, the closed days, or the payment-to-preparation rule; those requirements start in `delivery-calendar`.

## Impact

- API: new table for the week (migration seeded with today's behavior); `src/core/delivery-closed-days.js` (preparation validity and `firstPrepDay` read the week and the hours); the call sites that read the calendar today (`customer-deliveries`, `delivery-estimator`, `delivery-calendar-impact`, `admin-today`, `ups-pickup`, `admin-delivery-calendar`); new routes under `/api/v1/admin/delivery-calendar/week` (read, preview, save), listed in `docs/api-routes.json`; calendar history includes week events.
- Admin panel: `DeliveryCalendarPage` (rename, new tab), the menu label, `npm run contract:sync` for the new routes.
- Store: no code change; the checkout estimate and the customer's dates come from the API.
- Operations: orders paid inside the hours appear in that day's production queue.
