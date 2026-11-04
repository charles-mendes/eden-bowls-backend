# Spec Delta

## Purpose

Lets an operator see every US order that needs a UPS label, buy several labels in one action, and print them together.

## ADDED Requirements

### Requirement: Queue lists label work

The admin panel MUST list, for US subscriptions, the current cycle's paid invoice that has no active label, and the labels already created that are not delivered or voided. An order is ready when its invoice is paid, its address is complete, ship-from is set, and it has no active label. An order blocked by another label check MUST show the reason and MUST NOT be selectable. Brazil orders MUST NOT appear.

#### Scenario: Ready order

- **WHEN** a US subscription has a paid invoice, a complete address, ship-from is set, and no active label exists
- **THEN** the queue lists the order as ready and selectable

#### Scenario: Blocked order

- **WHEN** a US order has a P.O. Box address or no recipient name
- **THEN** the queue lists the order with the reason and it cannot be selected

#### Scenario: Label already created

- **WHEN** an invoice has a created label that is not delivered or voided
- **THEN** the queue lists the label as created, and it can be selected for printing

#### Scenario: Brazil order

- **WHEN** a Brazil subscription has a paid invoice
- **THEN** the queue does not list it

#### Scenario: Staff limited to one market

- **WHEN** a staff member scoped to Brazil opens the queue
- **THEN** the queue lists nothing

### Requirement: Batch purchase keeps one label per invoice

After the operator selects orders and confirms, the queue MUST buy a label only for selected orders without an active label, and MUST NOT buy a second label for an invoice. A failed purchase MUST NOT stop the others. Every selected order MUST end with a result: created, already had a label, or failed with its reason.

#### Scenario: Several orders bought

- **WHEN** the operator selects three ready orders and confirms
- **THEN** three labels are bought and each order shows created

#### Scenario: One purchase fails

- **WHEN** UPS rejects one of three selected orders
- **THEN** the other two labels are bought and the failed order shows the UPS reason

#### Scenario: Label bought elsewhere meanwhile

- **WHEN** a selected invoice got a label in the subscription detail before the batch reached it
- **THEN** the queue buys nothing for it and shows that it already had a label

#### Scenario: Nothing confirmed

- **WHEN** the operator selects orders and does not confirm
- **THEN** no label is bought

### Requirement: Labels print together

The queue MUST print every created label of the selection in one print job, one 4x6 page per label. A failed or blocked order MUST NOT add a page. When no label of the selection exists, the queue MUST NOT open a print job.

#### Scenario: Batch with a failure

- **WHEN** a batch created two labels and one purchase failed
- **THEN** one print job opens with two 4x6 pages

#### Scenario: Printing labels already created

- **WHEN** the operator selects three created labels and prints
- **THEN** one print job opens with three 4x6 pages and no label is bought

### Requirement: Corrections stay in the subscription detail

The queue MUST NOT void labels or edit addresses. Voiding, fixing an address, and reprinting a single label MUST stay available in the subscription detail, and the queue MUST link each order to it.

#### Scenario: Wrong address on a created label

- **WHEN** the operator finds a created label with a wrong address
- **THEN** the queue offers a link to the subscription detail and no void action
