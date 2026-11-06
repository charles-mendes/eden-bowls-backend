## ADDED Requirements

### Requirement: Dispatch needs an authorized NF-e when the fiscal lock is on

When the fiscal lock is on, dispatching a Brazil cycle whose invoice has no NF-e `authorized` MUST be refused with HTTP 422 and code `courier_nfe_not_authorized`, with `nfe_status` (the note's status, or `null` without a note) and `nfe_id` (or `null`) in the details, and no delivery stored. No request field, `confirm_not_ready` included, MUST release it. When the lock is off, dispatch MUST NOT look at the NF-e.

#### Scenario: Authorized note

- **WHEN** the lock is on and the invoice's NF-e is `authorized`
- **THEN** the dispatch follows the other checks and is stored

#### Scenario: Note still in flight

- **WHEN** the lock is on and the invoice's NF-e is `submitted`
- **THEN** the API returns 422 `courier_nfe_not_authorized` with `nfe_status` `submitted` and no delivery is stored

#### Scenario: No note recorded

- **WHEN** the lock is on and the invoice has no NF-e row
- **THEN** the API returns 422 `courier_nfe_not_authorized` with `nfe_status` null

#### Scenario: Confirmation does not release it

- **WHEN** the lock is on, the NF-e is `rejected` and the request sends `confirm_not_ready: true`
- **THEN** the API returns 422 `courier_nfe_not_authorized`, not the readiness confirmation

#### Scenario: Dispatch again after a failure

- **WHEN** the lock is on and an operator dispatches again an invoice whose last delivery failed and whose NF-e was canceled
- **THEN** the API returns 422 `courier_nfe_not_authorized` with `nfe_status` `canceled`

#### Scenario: Lock off

- **WHEN** the lock is off and the invoice has no NF-e
- **THEN** the dispatch is stored as before

### Requirement: The fiscal lock is set per environment

The fiscal lock MUST be read from `COURIER_REQUIRE_AUTHORIZED_NFE` and MUST be off without a value, whatever `NODE_ENV` is. It MUST be on only with an explicit true value.

#### Scenario: QA without the variable

- **WHEN** the API starts with `NODE_ENV=production` and no `COURIER_REQUIRE_AUTHORIZED_NFE`, as QA does
- **THEN** the lock is off

#### Scenario: Turned on

- **WHEN** the API starts with `COURIER_REQUIRE_AUTHORIZED_NFE=true`
- **THEN** the lock is on

#### Scenario: Turned off explicitly

- **WHEN** the API starts with `NODE_ENV=production` and `COURIER_REQUIRE_AUTHORIZED_NFE=false`
- **THEN** the lock is off

### Requirement: Queue rows show the invoice's NF-e

Every item of "A despachar" and "Falhas" in `GET /admin/courier-deliveries/queue` MUST carry `nfe`: `{ id, status, number }` of the NF-e of its invoice and Stripe account, or `null` without one. The response MUST carry `nfe_required`, true when the fiscal lock is on. Items of "Em rota" and "Entregues" MUST NOT need it.

#### Scenario: Rows with and without a note

- **WHEN** "A despachar" has one invoice with an authorized NF-e number 123 and one with no NF-e
- **THEN** the first item has `nfe` `{ id, status: "authorized", number: "123" }` and the second has `nfe` null

#### Scenario: Authorized without a number

- **WHEN** an invoice's NF-e is `authorized` and has no number yet
- **THEN** the item has `nfe` with `status` `authorized` and `number` null

#### Scenario: Lock reported

- **WHEN** the lock is off
- **THEN** the queue still carries `nfe` on each row and `nfe_required` is false

#### Scenario: Another market's note

- **WHEN** an NF-e exists for the same invoice id under another Stripe account
- **THEN** it is not used for the row
