# ups-label-queue Specification

## Purpose

Lets an operator see every US order that needs a UPS label, buy several labels in one action, and print them together.

## Requirements

### Requirement: Queue lists label work

The admin panel MUST list every paid US production cycle with no active label and a delivery date in the requested delivery range, every created label that is not delivered or voided, and every unresolved row. An order is ready when its invoice is paid, its address is complete, ship-from is set, and it has no active label. Brazil subscriptions MUST NOT be listed for any actor.

The delivery range is `from` to `to`, both civil dates included, with today taken in `America/New_York`. Without `from`, it starts 30 days before today; without `to`, it ends tomorrow. The range MUST NOT start earlier than 30 days before today, end before it starts, or have `to` more than 31 days after `from`; such a request, or a date that is not `YYYY-MM-DD`, MUST be refused with `400 invalid_delivery_range`. The range and the 100-item limit apply only to cycles with no active label. Created labels that are not delivered or voided, and unresolved rows, MUST be listed whatever their delivery date, as long as it is no more than 30 days in the past, and MUST NOT take a place in the 100.

The response MUST carry `range` (`from`, `to`, and `default`, true when neither date was sent), `later` (how many paid cycles with no active label have a delivery date after `to`, counted without the list's limit), and `truncated`. When the list is cut at its 100-item limit, the response MUST carry `next_from`, the delivery date of the first cycle left out; otherwise `next_from` is null.

#### Scenario: Ready order

- **WHEN** a US subscription has a paid cycle delivered today, a complete address, ship-from is set, and no active label exists
- **THEN** the queue lists the order as ready and selectable

#### Scenario: Ready order after the default range

- **WHEN** a paid cycle with no label has a delivery date in four days and the queue is read without a range
- **THEN** the queue does not list it as ready and `later` counts it

#### Scenario: Two paid cycles without a label

- **WHEN** one US subscription has two paid cycles in the range and neither has a label
- **THEN** the queue lists both cycles

#### Scenario: Old cycle

- **WHEN** a paid cycle without a label has a delivery date 31 days ago
- **THEN** the queue does not list it

#### Scenario: Range too long

- **WHEN** the queue is read with a range of 40 days
- **THEN** the request is refused with `400 invalid_delivery_range`

#### Scenario: Label already created

- **WHEN** an invoice has a created label that is not delivered or voided, for a delivery in five days
- **THEN** the queue lists the label as created in the default range, and it can be selected for printing

#### Scenario: Created label with a full ready list

- **WHEN** 100 cycles without a label are in the range and one created label exists for a delivery in five days
- **THEN** the queue lists the 100 as ready and the created label as created

#### Scenario: List cut at the limit

- **WHEN** 120 cycles without a label are in the range
- **THEN** the queue lists 100, `truncated` is true and `next_from` is the delivery date of the 101st

#### Scenario: Brazil order

- **WHEN** a Brazil subscription has a paid cycle, even for an admin with access to every market
- **THEN** the queue does not list it

#### Scenario: Staff limited to Brazil

- **WHEN** a staff member scoped to Brazil opens the queue
- **THEN** the queue lists nothing

### Requirement: Blocked orders show why

An order that fails a label check MUST show the reason and MUST NOT be selectable. The checks MUST be the same ones a single purchase uses: market exception, country, P.O. Box, APO/FPO/DPO military address, incomplete address, missing ship-from, and missing recipient name.

#### Scenario: P.O. Box

- **WHEN** a US order has a P.O. Box address
- **THEN** the queue lists the order with that reason and it cannot be selected

#### Scenario: Military address

- **WHEN** a US order's city is APO, FPO, or DPO
- **THEN** the queue and a single purchase both refuse it with the military address reason

#### Scenario: Crossed subscription

- **WHEN** a single purchase is asked for a subscription with account `us` and address country `BR`
- **THEN** the API returns 422 with code `shipment_market_exception` and no label is bought

### Requirement: The queue shows enough to choose

Each order MUST show the customer name, city, ZIP, production status, subscription status, and delivery date. Neither status MUST hide an order. Buying a selection that includes an order whose production status is not `ready`, or whose subscription is not `active` or `trialing`, MUST require a second confirmation that names those orders.

#### Scenario: Food still in preparation

- **WHEN** a paid US cycle is `to_prepare` and has a complete address
- **THEN** the queue lists it with that status and asks for the extra confirmation before buying

#### Scenario: Paused subscription with a paid cycle

- **WHEN** a paused subscription has a paid cycle without a label
- **THEN** the queue lists it with the paused status and asks for the extra confirmation before buying

### Requirement: Unresolved shipments stay visible

An order whose active row is `pending` or `unknown` MUST be listed as unresolved, to be checked in UPS. It MUST NOT be selectable for purchase and MUST NOT be printed. The queue MUST NOT delete or void that row, and MUST link it to the subscription detail.

#### Scenario: Timeout after UPS may have created the label

- **WHEN** a purchase ends with no confirmed UPS outcome
- **THEN** the queue lists that order as unresolved and a later batch does not buy another label for its invoice

### Requirement: Batch purchase keeps one label per invoice

After the operator selects orders and confirms, the queue MUST buy a label only for selected orders without an active label, one at a time, and MUST NOT buy a second label for an invoice. Confirming again MUST be blocked until the batch ends. A failed purchase MUST NOT stop the others. Every selected order MUST end with one result: created, already had a label, in progress with its shipment id, or failed with its reason.

#### Scenario: Several orders bought

- **WHEN** the operator selects three ready orders and confirms
- **THEN** three labels are bought and each order shows created

#### Scenario: One purchase fails

- **WHEN** UPS rejects one of three selected orders
- **THEN** the other two labels are bought and the failed order shows the UPS reason

#### Scenario: Label bought elsewhere meanwhile

- **WHEN** a selected invoice got a label in the subscription detail before the batch reached it
- **THEN** the queue buys nothing for it and shows that it already had a label

#### Scenario: Two operators confirm the same order

- **WHEN** one purchase is still waiting for UPS and the other batch reaches that invoice
- **THEN** the second result says the purchase is in progress, with the shipment id, and no second label is bought

#### Scenario: UPS outcome unknown

- **WHEN** a purchase in the batch ends without a confirmed UPS outcome
- **THEN** that order shows in progress, is not printed, and offers no retry from the queue

#### Scenario: Nothing confirmed

- **WHEN** the operator selects orders and does not confirm
- **THEN** no label is bought

### Requirement: Labels print together

The queue MUST print every created label of the selection in one print job, one 4x6 page per label, whether it was bought in this batch or before. A failed, blocked, or unresolved order MUST NOT add a page. A created label whose file is missing MUST be named as missing and MUST NOT add a page. When no label of the selection can print, the queue MUST NOT open a print job.

#### Scenario: Batch with a failure and an existing label

- **WHEN** a batch of three bought one label, found one already created, and failed one
- **THEN** one print job opens with two 4x6 pages

#### Scenario: Printing labels already created

- **WHEN** the operator selects three created labels and prints
- **THEN** one print job opens with three 4x6 pages and no label is bought

#### Scenario: Label file missing

- **WHEN** one of two selected created labels has no stored file
- **THEN** one page prints and that order shows the file is missing

### Requirement: Corrections stay in the subscription detail

The queue MUST NOT void labels or edit addresses. Voiding, fixing an address, and reprinting a single label MUST stay in the subscription detail, and the queue MUST link each order to it. Voiding in the detail MUST ask for confirmation. Closing a `pending` or `unknown` row MUST require the operator to confirm that UPS has no label for it before the row is closed locally.

#### Scenario: Wrong address on a created label

- **WHEN** the operator finds a created label with a wrong address
- **THEN** the queue offers a link to the subscription detail and no void action

#### Scenario: Closing an unresolved row

- **WHEN** the operator checked UPS, found no label, and confirms it in the subscription detail
- **THEN** the row is closed locally without a UPS call and the order is ready again

### Requirement: Buying a label for an order that is not ready needs confirmation

Buying a UPS label for a paid invoice MUST answer `409 ups_label_needs_confirmation` with the list of reasons when the cycle's production status is not `ready` (`production_not_ready`) or the subscription is not active (`subscription_not_active`), unless the request carries `confirm_not_ready: true`. The reasons and codes MUST be the same as the courier dispatch. Nothing MUST be bought or stored before the confirmation. An address or settings problem that refuses the purchase (422) MUST answer before the confirmation, so the operator is never asked to confirm a purchase that would be refused. An invoice that already holds an active shipment MUST keep answering as today, with no confirmation, because nothing is bought. A confirmed purchase MUST record the confirmed reasons in its audit event.

#### Scenario: Order still being prepared

- **WHEN** an operator buys a label for a paid invoice whose cycle is `in_production`, without confirmation
- **THEN** the API returns 409 with reason `production_not_ready` and no shipment row exists

#### Scenario: Confirmed

- **WHEN** the same request carries `confirm_not_ready: true`
- **THEN** the label is bought and the audit event lists `production_not_ready`

#### Scenario: Ready order

- **WHEN** the cycle is `ready` and the subscription active
- **THEN** the label is bought without confirmation

#### Scenario: Bad address and not ready

- **WHEN** the cycle is not ready and the shipping address is incomplete
- **THEN** the API returns the 422 for the address, not the 409

#### Scenario: Shipment already active

- **WHEN** the invoice already has a created label and the cycle is not ready
- **THEN** the API returns the existing shipment as today, without asking for confirmation

### Requirement: Created labels carry their pickup

Every `created` item of `GET /admin/shipments/queue` MUST carry `pickup`: `{ id, pickup_date, status, prn }` of its active pickup (`pending`, `requested` or `unknown`, with a `pending` older than 5 minutes shown as `unknown`), or `null` when it has none. A canceled or not created pickup MUST NOT count.

#### Scenario: Label in a pickup

- **WHEN** a created label belongs to a requested pickup for 2026-11-09 with PRN 2929602E9CP
- **THEN** its item has `pickup` `{ id, pickup_date: "2026-11-09", status: "requested", prn: "2929602E9CP" }`

#### Scenario: Pickup canceled

- **WHEN** a created label's only pickup was canceled
- **THEN** its item has `pickup` null

### Requirement: The label queue lists only the US market

The UPS label queue MUST include a paid cycle only when its subscription's shipping market is US: account `us` and address country `US`.

#### Scenario: US account with a Brazil address

- **WHEN** a subscription with account `us` and address country `BR` has a paid cycle
- **THEN** the label queue does not list it, and it appears only in the market exceptions list
