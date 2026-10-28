# Spec Delta

## Purpose

Lets the kitchen know how many ready packs exist per market, recipe and pack size, how many the upcoming subscription deliveries already need, and how many must still be produced, with every stock change traceable to a person or a production cycle.

## ADDED Requirements

### Requirement: Stock item identity

A stock item SHALL be identified by market (`BR` or `US`), recipe key and pack size in whole grams. The system MUST accept a recipe and size only when the market's catalog has, or had, a variation with that recipe and size, or when the item already exists. Otherwise it MUST respond `422` with code `stock_item_unknown`.

#### Scenario: Known recipe and size

- **WHEN** an operator records production for `BR`, recipe `frango`, `300` g, and the BR catalog has that variation
- **THEN** the system accepts it and the item `BR / frango / 300` exists afterwards

#### Scenario: Size not sold in the market

- **WHEN** an operator records production for `BR`, recipe `frango`, `750` g, and no BR variation has that size
- **THEN** the system responds `422` with code `stock_item_unknown` and no movement is written

### Requirement: Balance equals the sum of movements

Every change to an item's on-hand quantity MUST be written as a movement with type (`production`, `separation`, `separation_reversal` or `adjustment`), signed quantity, author or production cycle, and time. The on-hand quantity MUST always equal the sum of the item's movements and MAY be negative.

#### Scenario: Balance after mixed movements

- **WHEN** an item receives production of 40, a separation of 12 and an adjustment of -3
- **THEN** its on-hand quantity is 25 and its history lists the three movements, newest first

### Requirement: Record production

A user with `production.write` SHALL record produced packs for an item with a whole quantity from 1 to 10000 and an optional note of up to 255 characters. The system MUST add a `production` movement and return the updated item. Other quantities MUST be rejected with `400`.

#### Scenario: Kitchen records a batch

- **WHEN** an operator records 30 packs of `BR / carne / 500`
- **THEN** on-hand rises by 30 and a `production` movement names the operator

#### Scenario: Zero quantity

- **WHEN** an operator records production with quantity `0`
- **THEN** the system responds `400` and on-hand is unchanged

#### Scenario: Readonly cannot record

- **WHEN** a `readonly` user records production
- **THEN** the system responds `403` and no movement is written

### Requirement: Manual adjustment

A user with `production.write` SHALL adjust an item by a non-zero whole quantity from -10000 to 10000 with a reason of `loss`, `expired`, `count`, `sample` or `other`. A note MUST be present when the reason is `other`. The system MUST write an `adjustment` movement even when on-hand becomes negative.

#### Scenario: Expired packs written off

- **WHEN** an operator adjusts `US / chicken / 454` by `-5` with reason `expired`
- **THEN** on-hand drops by 5 and the movement stores reason `expired`

#### Scenario: Other without note

- **WHEN** an operator adjusts with reason `other` and no note
- **THEN** the system responds `400` and on-hand is unchanged

### Requirement: Separation deducts the cycle packs once

When a production cycle moves from `in_production` to `ready`, the system MUST write one `separation` movement per recipe and size of that cycle, subtracting its quantity. A cycle that already has an unreversed separation MUST NOT be deducted again. Lines without a pack size MUST be skipped and reported.

#### Scenario: Cycle separated

- **WHEN** an operator marks ready a BR cycle with 4 × `frango / 300` and 2 × `carne / 300`
- **THEN** on-hand of `BR / frango / 300` drops by 4, `BR / carne / 300` drops by 2, and both movements reference that subscription and cycle

#### Scenario: Ready sent twice

- **WHEN** the same cycle reaches `ready` again without a reversal in between
- **THEN** no new separation movement is written

### Requirement: Returning a cycle restores what was deducted

When a production cycle moves from `ready` back to `in_production`, the system MUST write `separation_reversal` movements that add back exactly the quantities its open separation subtracted, even if the subscription's packs changed after the separation.

#### Scenario: Return after a pack change

- **WHEN** a cycle separated with 4 × `frango / 300` returns to `in_production` after the customer changed to 6 packs
- **THEN** a reversal of `+4` is written for `frango / 300`, and a later separation subtracts the 6 packs then shown

### Requirement: Shortage warns without blocking

A status change to `ready` MUST succeed whatever the stock. When a separation leaves an item below zero, or a line has no pack size, the response MUST include them in a `stock` object with `shortages` (recipe, size, on-hand after the movement) and `unsized` (line count).

#### Scenario: Separation with too little stock

- **WHEN** `BR / frango / 300` has 2 on hand and an operator marks ready a cycle with 4 of it
- **THEN** the cycle becomes `ready`, on-hand is `-2`, and `stock.shortages` lists `frango / 300` with `-2`

### Requirement: Queue keeps working without stock storage

When the stock tables do not exist, production status changes MUST still succeed without writing movements, the response `stock` MUST be empty, and every queue item's `stockCoverage` MUST be `null`.

#### Scenario: Status change after a migration rollback

- **WHEN** the stock migration was rolled back and an operator marks a paid cycle ready
- **THEN** the cycle becomes `ready`, the response has no shortages, and the queue lists items with `stockCoverage` null

### Requirement: Stock overview for a window

A user with `production.read` SHALL list stock items of one market for a window of 7, 14 or 30 days. Each item MUST return on-hand, committed, committed awaiting payment, available (on-hand minus committed), to produce (the shortfall, never below zero), minimum level and whether available is below it.

#### Scenario: Kitchen plans the week

- **WHEN** `BR / frango / 300` has 40 on hand and queue cycles in the next 7 days not yet separated need 55, of which 10 await payment
- **THEN** the item shows committed 55, awaiting payment 10, available -15 and to produce 15

#### Scenario: Invalid window

- **WHEN** the overview is requested with a window of 10 days
- **THEN** the system responds `400` with code `invalid_window_days`

### Requirement: Committed demand follows the production queue

Committed MUST be the sum of the packs of the cycles the production queue shows for the same window and market, including overdue ones, whose status is `to_prepare` or `in_production`. Blocked and ready cycles MUST NOT count. Items with demand and no stock movement MUST still appear with on-hand 0.

#### Scenario: Blocked and ready cycles are left out

- **WHEN** the window holds one `to_prepare` cycle with 3 packs, one `blocked` with 5 and one `ready` with 4 of the same item
- **THEN** that item's committed is 3

#### Scenario: New recipe with demand only

- **WHEN** a cycle needs `US / salmon / 454` and that item has no movement yet
- **THEN** the overview lists it with on-hand 0 and to produce equal to its demand

### Requirement: Lines without pack size stay visible

A queue line whose pack size cannot be resolved MUST NOT count toward any item. The overview MUST return `unsizedLines` with one entry per such line (subscription id, recipe or label, quantity) for the same window and market. Each time a line is left out, in the overview or in a separation, the system MUST write a warning log with the subscription id, the cycle and the line label.

#### Scenario: Overview reports a line without size

- **WHEN** a `to_prepare` cycle in the window has 3 packs of `frango` with no grams and an unreadable label
- **THEN** no item's committed includes them, `unsizedLines` lists that subscription with `frango` and 3, and a warning log names the subscription and cycle

#### Scenario: Nothing unsized

- **WHEN** every line in the window has a pack size
- **THEN** `unsizedLines` is an empty array

### Requirement: Optional minimum level

A user with `production.write` SHALL set an item's minimum level to a whole number from 0 to 10000, or clear it. When set, the item MUST report `belowMinimum` true while available is below it.

#### Scenario: Below minimum after commitments

- **WHEN** an item has minimum 10, on-hand 20 and committed 15
- **THEN** available is 5 and `belowMinimum` is true

### Requirement: Movement history

A user with `production.read` SHALL list one market's movements, newest first and paginated, filtered optionally by recipe, size and type. Each movement MUST return type, signed quantity, reason, note, author name or the linked subscription and cycle, and time.

#### Scenario: History of one item

- **WHEN** an operator lists movements of `BR / frango / 300`
- **THEN** only that item's movements are returned, newest first, with the total for pagination

### Requirement: Queue cycles report stock coverage

Each production queue item MUST report `stockCoverage`: `covered`, `short` or `unknown` for cycles in `to_prepare` or `in_production`, and `null` otherwise. On-hand of each item MUST be allotted to those cycles in due order across the whole window, and a cycle is `short` when any of its lines is not fully allotted.

#### Scenario: Earlier delivery takes the stock first

- **WHEN** an item has 5 on hand and two cycles of the window need 4 each, due tomorrow and in three days
- **THEN** the cycle due tomorrow is `covered` and the one due in three days is `short`

#### Scenario: Line without pack size

- **WHEN** a cycle has a line without a pack size
- **THEN** its `stockCoverage` is `unknown`
