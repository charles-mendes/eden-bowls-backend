# Spec Delta

## Purpose

Lets an operator see every US order that needs a UPS label, buy several labels in one action, and print them together.

## ADDED Requirements

### Requirement: Queue lists label work

The admin panel MUST list every paid US production cycle with no active label and a delivery date no more than 30 days in the past, every created label that is not delivered or voided, and every unresolved row. An order is ready when its invoice is paid, its address is complete, ship-from is set, and it has no active label. Brazil subscriptions MUST NOT be listed for any actor.

#### Scenario: Ready order

- **WHEN** a US subscription has a paid cycle, a complete address, ship-from is set, and no active label exists
- **THEN** the queue lists the order as ready and selectable

#### Scenario: Two paid cycles without a label

- **WHEN** one US subscription has two paid cycles and neither has a label
- **THEN** the queue lists both cycles

#### Scenario: Old cycle

- **WHEN** a paid cycle without a label has a delivery date 31 days ago
- **THEN** the queue does not list it

#### Scenario: Label already created

- **WHEN** an invoice has a created label that is not delivered or voided
- **THEN** the queue lists the label as created, and it can be selected for printing

#### Scenario: Brazil order

- **WHEN** a Brazil subscription has a paid cycle, even for an admin with access to every market
- **THEN** the queue does not list it

#### Scenario: Staff limited to Brazil

- **WHEN** a staff member scoped to Brazil opens the queue
- **THEN** the queue lists nothing

### Requirement: Blocked orders show why

An order that fails a label check MUST show the reason and MUST NOT be selectable. The checks MUST be the same ones a single purchase uses: country, P.O. Box, APO/FPO/DPO military address, incomplete address, missing ship-from, and missing recipient name.

#### Scenario: P.O. Box

- **WHEN** a US order has a P.O. Box address
- **THEN** the queue lists the order with that reason and it cannot be selected

#### Scenario: Military address

- **WHEN** a US order's city is APO, FPO, or DPO
- **THEN** the queue and a single purchase both refuse it with the military address reason

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
