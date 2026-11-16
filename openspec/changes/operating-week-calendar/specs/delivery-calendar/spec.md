# Spec Delta

## Purpose

Defines the days and hours each market prepares orders: the standard week the operator sets, the closed days that override it, how a payment becomes a preparation day, and how a change of the week is previewed, applied to scheduled deliveries and recorded.

## ADDED Requirements

### Requirement: Each market has a standard week of preparation
The system SHALL keep, for each market (`BR`, `US`), one entry per weekday (Monday to Sunday) with `open` (true or false) and, when open, `opensAt` and `closesAt` as `HH:MM` in the market's time zone (`BR`: `America/Sao_Paulo`, `US`: `America/New_York`). `GET /api/v1/admin/delivery-calendar/week?market=` MUST return the seven entries of that market.

#### Scenario: Reading the week of a market
- **WHEN** an admin with `production.read` requests the week of `BR`
- **THEN** the response lists seven weekdays, Monday first, each with `open`, `opensAt` and `closesAt`, and the time zone `America/Sao_Paulo`

### Requirement: The week after deploy is the one the system applied before
On deploy, the stored week MUST open Monday to Saturday for `BR` and Monday to Friday for `US`, each open day from 09:00 to 20:00, so that no scheduled delivery is postponed on deploy. A renewal charged before closing on an open day MAY move to an earlier day, its charge day.

#### Scenario: No scheduled delivery is postponed on deploy
- **WHEN** the change is deployed with subscriptions already scheduled: a renewal charged at 14:30 on a Tuesday, a charge at 00:00, and a Brazil delivery prepared on a Saturday
- **THEN** no preparation day or delivery date read after deploy is later than before; the 14:30 Tuesday renewal prepares on Tuesday instead of Wednesday, and the others keep their dates

### Requirement: Only an open weekday is a preparation day
A date MUST be a preparation day only when its weekday is open in the market's week and no active closed day of that market closes preparation on that date. The rules that are not about preparation MUST stay as they are: UPS does not pick up or deliver on Saturday or Sunday, and the Brazil delivery time in business days skips Saturday, Sunday and the dates that close delivery.

#### Scenario: Closed weekday
- **WHEN** Saturday is not open in the `BR` week
- **THEN** no Brazil delivery is prepared on a Saturday

#### Scenario: Closed day overrides an open weekday
- **WHEN** Wednesday is open in the `BR` week and an active closed day on a Wednesday closes preparation
- **THEN** that Wednesday is not a preparation day, and the other Wednesdays are

#### Scenario: Opening Friday and Saturday does not make UPS pick up on a weekend
- **WHEN** Friday and Saturday are open in the `US` week
- **THEN** no US delivery is prepared on a Friday or a Saturday, because its UPS pickup the next day would fall on a weekend

#### Scenario: Opening Sunday in the United States prepares on Sunday
- **WHEN** Sunday is open in the `US` week and no closed day closes it
- **THEN** a US delivery can be prepared on Sunday, with the UPS pickup on Monday

### Requirement: The hours decide the preparation day of a payment
For a payment at a moment in the market's time zone, the preparation day MUST be that date when the date is a preparation day and the local time is before `closesAt` (including before `opensAt`). Otherwise it MUST be the next preparation day. Every delivery date the system shows or stores (checkout estimate, order email, production queue, the customer's deliveries) MUST follow this rule.

#### Scenario: Paid inside the hours
- **WHEN** a Brazil customer pays at 10:00 on a Tuesday open 09:00–20:00
- **THEN** the preparation day is that Tuesday

#### Scenario: Paid before opening, as a renewal at midnight
- **WHEN** a renewal is charged at 00:00 on a Tuesday open 09:00–20:00
- **THEN** the preparation day is that Tuesday

#### Scenario: Paid after closing
- **WHEN** a customer pays at 20:00 on a Friday open 09:00–20:00, with Saturday and Sunday not open
- **THEN** the preparation day is the following Monday

#### Scenario: Paid on a closed day
- **WHEN** a customer pays at 11:00 on a Sunday
- **THEN** the preparation day is the next open weekday that no closed day closes for preparation

### Requirement: A week is valid before it is stored
A save MUST be refused with `422` and nothing stored when an open day has `opensAt` not earlier than `closesAt`, a time that is not a valid `HH:MM`, or when no weekday is open. For `US` it MUST also be refused when no weekday from Sunday to Thursday is open, since only those reach a weekday UPS pickup.

#### Scenario: Closing before opening
- **WHEN** the operator saves Monday open from 20:00 to 09:00
- **THEN** the response is `422` with code `invalid_week_hours` and the stored week does not change

#### Scenario: No day can prepare in the United States
- **WHEN** the operator saves the `US` week with only Friday and Saturday open
- **THEN** the response is `422` with code `week_without_preparation` and the stored week does not change

### Requirement: Every change of the week is previewed before it is saved
`POST /api/v1/admin/delivery-calendar/week/preview?market=` with a proposed week MUST return, without storing anything, every scheduled delivery whose projected preparation day under the proposed week differs from the one under the stored week, later or earlier, including when only the hours change or a weekday opens. Each item MUST carry its subscription, its current and new preparation day and delivery date, and its outcome:
- `kept` when it is paid, in production, ready or blocked: it keeps its stored date;
- `moved_charge_kept` when it is unpaid and past the customer's edit deadline;
- `moved` otherwise.

The Stripe charge MUST move only for a `moved` delivery charged at 00:00 of its current preparation day. Every other charge stays at its time, and only preparation and delivery change.

#### Scenario: Closing Saturday in Brazil
- **WHEN** the operator previews the `BR` week with Saturday not open
- **THEN** the preview lists each scheduled delivery prepared on a Saturday with its new preparation day and delivery date and its outcome

#### Scenario: Unpaid delivery past the edit deadline
- **WHEN** the operator previews closing Saturday on Saturday at 10:00 (past the deadline, which ends at 23:59 the day before the charge), and a renewal is charged at 14:30 that Saturday
- **THEN** that delivery is `moved_charge_kept`, with its charge kept on Saturday at 14:30 and the next open day as its new preparation day

#### Scenario: Changing only the hours
- **WHEN** the operator previews the same open days with closing at 14:00 instead of 20:00, and a renewal is charged at 14:30 on a Tuesday
- **THEN** the preview lists that delivery as `moved` from Tuesday to Wednesday, with its charge kept on Tuesday at 14:30

#### Scenario: Opening a weekday
- **WHEN** the operator previews the `BR` week with Saturday open after it was closed, and a renewal is charged at 10:00 on a Saturday
- **THEN** the preview lists that delivery as `moved` from Monday to Saturday, with its charge unchanged

#### Scenario: Nothing changes
- **WHEN** the proposed week projects every scheduled delivery on the same day as the stored week
- **THEN** the preview lists no delivery and states that the week applies to payments from then on

### Requirement: Saving the week applies the previewed impact
`PUT /api/v1/admin/delivery-calendar/week?market=` MUST carry the confirmed moves: each `moved` and `moved_charge_kept` delivery as its id and new preparation day; `kept` ones are left out. When the moves computed at save time differ, the save MUST be refused with `409` `week_impact_changed`, storing nothing. Otherwise, in one transaction, it MUST store the week and sync, as closed days do, the Stripe charge of each `moved` delivery charged at 00:00 of its current preparation day. Every other charge MUST stay unchanged.

#### Scenario: Save after preview
- **WHEN** the operator saves the `BR` week without Saturday, confirming the moves of the preview
- **THEN** the week is stored, each `moved` Saturday delivery charged at 00:00 gets a Stripe sync to its new preparation day, and each `kept` one keeps its date

#### Scenario: The impact changed after the preview
- **WHEN** a new subscription is scheduled on a Saturday between the preview and the save
- **THEN** the save is refused with `409` `week_impact_changed`, nothing is stored, and the operator previews again

#### Scenario: Paid or in-production delivery does not block the save
- **WHEN** a paid Saturday delivery, or one in production, ready or blocked, is in the preview
- **THEN** the save succeeds, that delivery keeps its Saturday preparation day, and it is not part of the confirmed moves

#### Scenario: Unpaid delivery past the edit deadline after the save
- **WHEN** the week without Saturday is saved on Saturday at 10:00 and a renewal past its edit deadline is charged at 14:30 that Saturday
- **THEN** Stripe charges it on Saturday at 14:30, and the customer's deliveries, the production queue and the paid cycle all show the next open day as its preparation day

### Requirement: Only the staff of the market changes its week
Reading the week MUST require `production.read` and previewing or saving it MUST require `production.write`. A request for a market outside the staff member's markets MUST be refused with `403` and code `market_forbidden`.

#### Scenario: Brazil operator and the United States week
- **WHEN** an operator scoped to `BR` saves the `US` week
- **THEN** the response is `403` `market_forbidden` and the `US` week does not change

### Requirement: Every change of the week is in the calendar history
Each stored change of the week MUST be recorded with who made it, when, the market, the week before and after, and each delivery of the impact with its outcome. The calendar history of a market and year MUST list these changes made in that year together with the changes of closed days, most recent first.

#### Scenario: History after closing Saturday
- **WHEN** the operator closes Saturday in the `BR` week in 2026
- **THEN** the `BR` calendar history of 2026 shows that change with the operator's email, the Saturday before and after, and the moved deliveries
