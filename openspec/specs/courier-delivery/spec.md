# courier-delivery Specification

## Purpose

Lets operations record by hand the courier delivery of each paid Brazil cycle, follow it from the admin panel, and show its progress to the customer in the store.

## Requirements

### Requirement: Only a paid Brazil delivery can get a courier record

A courier delivery MUST belong to one subscription invoice. The invoice MUST be paid, MUST belong to that subscription, and MUST be a charged delivery: a first or cycle invoice whose subtotal is above zero. The subscription's shipping market MUST be BR: Stripe account `br` and delivery address country `BR`. Any other invoice MUST be refused with HTTP 422 and no record is stored.

#### Scenario: Paid Brazil cycle

- **WHEN** an operator registers a delivery for a paid cycle invoice of a subscription with account `br` delivered in Brazil
- **THEN** the record is stored as out for delivery

#### Scenario: US subscription

- **WHEN** an operator registers a courier delivery for a subscription with account `us` whose delivery address is in the US
- **THEN** the API returns 422 with code `courier_country_not_supported`

#### Scenario: Crossed subscription

- **WHEN** an operator registers a courier delivery for a subscription with account `us` whose delivery address is in Brazil
- **THEN** the API returns 422 with code `shipment_market_exception`

#### Scenario: Skipped cycle

- **WHEN** the invoice is paid with a subtotal of zero
- **THEN** the API returns 422 with code `invoice_not_delivery`

#### Scenario: Unpaid invoice

- **WHEN** the invoice is open
- **THEN** the API returns 422 with code `invoice_not_paid`

### Requirement: Dispatch records how the box left

Dispatch MUST store the method (`uber`, `motoboy`, `own_driver` or `other`) and MAY store a courier name (up to 120 characters), a tracking link, a cost in BRL and a note (up to 500 characters). The cost MUST be zero or more with at most two decimals. Dispatch MUST store the current instant as the out-for-delivery date and the staff member who did it. Any invalid field MUST answer 422 and store nothing.

#### Scenario: Uber with a tracking link

- **WHEN** an operator registers method `uber`, cost R$ 18,50 and an `https` tracking link
- **THEN** the record holds them, its status is out for delivery, and its out-for-delivery date is now

#### Scenario: Cost format

- **WHEN** the cost is `18.50`, then `-1`, then `18.555`
- **THEN** the first is stored as 1850 centavos and the other two return 422

#### Scenario: Method missing

- **WHEN** the method is absent or not one of the four values
- **THEN** the API returns 422 and no record is stored

### Requirement: A tracking link is a plain https URL

A tracking link, after trimming, MUST parse as an absolute URL whose protocol is `https:`, with a host, with no username or password, no spaces, and at most 500 characters. Anything else MUST be refused with 422 and field `tracking_url`. An empty value means no link.

#### Scenario: Valid link

- **WHEN** the link is `https://trip.uber.com/abc123`
- **THEN** it is stored as given

#### Scenario: Rejected links

- **WHEN** the link is `http://trip.uber.com/abc`, `https://user:pass@trip.uber.com/abc`, `javascript:alert(1)`, `trip.uber.com/abc`, or an `https` URL of 501 characters
- **THEN** each returns 422 with field `tracking_url` and nothing is stored

### Requirement: One active delivery per invoice

An invoice MUST have at most one active courier delivery. Out for delivery and delivered are active. Failed and canceled are not. Two dispatches of the same invoice at the same time MUST leave one record, and the second request MUST get HTTP 409.

#### Scenario: Second dispatch while on the road

- **WHEN** an operator dispatches an invoice that already has a delivery out for delivery
- **THEN** the API returns 409 with code `courier_delivery_active` and nothing changes

#### Scenario: Two dispatches at once

- **WHEN** two operators dispatch the same invoice at the same time
- **THEN** one record exists and the other request gets 409

#### Scenario: New attempt after a failure

- **WHEN** the only delivery of an invoice failed and an operator dispatches it again
- **THEN** a new record is stored as out for delivery and the failed one is kept

#### Scenario: New dispatch after a cancel

- **WHEN** the only delivery of an invoice was canceled and an operator dispatches it again
- **THEN** a new record is stored as out for delivery and the canceled one is kept

### Requirement: Status moves only forward

Only a delivery out for delivery MUST be able to become delivered, failed or canceled. Delivered stores a delivery instant, which defaults to now, MUST NOT be after now, and MUST NOT be before the out-for-delivery date. Failed stores a reason. Delivered, failed and canceled are final: any later status change, including a repeat of the same one, MUST answer 409 `courier_delivery_final`. When two changes race, exactly one MUST succeed.

#### Scenario: Mark delivered

- **WHEN** an operator marks a delivery out for delivery as delivered with no date
- **THEN** its status is delivered and its delivered date is now

#### Scenario: Delivered date in the future

- **WHEN** the delivered date given is tomorrow
- **THEN** the API returns 422 and the status is unchanged

#### Scenario: Failure without a reason

- **WHEN** an operator marks a delivery as failed with no reason
- **THEN** the API returns 422 and the status is unchanged

#### Scenario: Change after delivered

- **WHEN** an operator tries to mark a delivered delivery as failed
- **THEN** the API returns 409 with code `courier_delivery_final`

#### Scenario: Two completions at once

- **WHEN** two operators mark the same delivery delivered and failed at the same time
- **THEN** one request succeeds, the other gets 409 `courier_delivery_final`, and the record holds only the winning status

#### Scenario: Repeated delivered

- **WHEN** an operator marks a delivered delivery delivered again
- **THEN** the API returns 409 and the delivered date is unchanged

### Requirement: Details can be corrected while not canceled

The method, courier name, tracking link, cost and note MUST be editable on a delivery out for delivery, delivered or failed, with the same validation as dispatch. Editing MUST NOT change the status or any stage date. Editing a canceled delivery MUST answer 409 `courier_delivery_final`.

#### Scenario: Cost corrected after delivery

- **WHEN** an operator changes the cost of a delivered delivery
- **THEN** the cost changes, and the status and delivered date stay the same

#### Scenario: Edit a canceled delivery

- **WHEN** an operator edits the note of a canceled delivery
- **THEN** the API returns 409 and nothing changes

### Requirement: Every action is audited and permission checked

Reading MUST require `shipping.read` and every write MUST require `shipping.write`. Routes MUST follow the admin market scope: staff limited to the US MUST NOT see or change any courier delivery, and a record outside the actor's market MUST answer 404. Each dispatch, status change, edit and cancel MUST be recorded in the admin audit log with the actor.

#### Scenario: Staff limited to the US

- **WHEN** a staff member scoped to the US opens the courier queue
- **THEN** the queue lists nothing

#### Scenario: Read-only staff

- **WHEN** a staff member with `shipping.read` and without `shipping.write` marks a delivery delivered
- **THEN** the API returns 403 and nothing changes

#### Scenario: Audit entry

- **WHEN** an operator marks a delivery failed
- **THEN** the audit log has an entry with the actor, the delivery and the reason

### Requirement: The queue lists Brazil delivery work in four groups

The admin queue MUST list, for Brazil subscriptions: to dispatch, which is paid cycles with no active delivery and no failed delivery whose delivery date falls in the requested delivery range; out for delivery, which is every delivery in that status, whatever its age; failed, which is every failed delivery whose invoice has no active delivery, whatever its age; and delivered, which is deliveries whose delivered date falls in the last 7 days. Days are civil days in `America/Sao_Paulo`, with today counted. An invoice MUST appear in one group only.

The delivery range is `from` to `to`, both civil dates included. Without `from`, it starts 30 days before today; without `to`, it ends tomorrow. The range MUST NOT start earlier than 30 days before today, end before it starts, or have `to` more than 31 days after `from` (the default range, 30 days ago to tomorrow, is exactly 31 days); such a request, or a date that is not `YYYY-MM-DD`, MUST be refused with `400 invalid_delivery_range`. The range limits only the to dispatch group.

The response MUST carry `range` (`from`, `to`, and `default`, true when neither date was sent), `later` (how many cycles would be to dispatch with a delivery date after `to`, counted without the list's limit), and `truncated`. The 200-item limit MUST count only cycles to dispatch: a cycle whose invoice already has a delivery out for delivery, delivered or failed MUST NOT take a place in it. When the to dispatch list is cut at that limit, the response MUST carry `next_from`, the delivery date of the first cycle left out; otherwise `next_from` is null.

#### Scenario: Paid cycle waiting

- **WHEN** a Brazil subscription has a paid cycle with no courier delivery, delivered tomorrow
- **THEN** the queue lists it under to dispatch in the default range

#### Scenario: Cycle after the default range

- **WHEN** a paid cycle with no courier delivery has a delivery date in three days and the queue is read without a range
- **THEN** the queue does not list it under to dispatch and `later` counts it

#### Scenario: Range that reaches the cycle

- **WHEN** the queue is read with `from` today and `to` in five days
- **THEN** the cycle delivered in three days is listed under to dispatch and `range.default` is false

#### Scenario: Old paid cycle

- **WHEN** a paid cycle with no courier delivery has a delivery date 31 days ago
- **THEN** the queue does not list it

#### Scenario: Default range is accepted

- **WHEN** the queue is read with `from` 30 days ago and `to` tomorrow
- **THEN** the request is accepted, as the default range is

#### Scenario: Range before the floor

- **WHEN** the queue is read with `from` 40 days ago
- **THEN** the request is refused with `400 invalid_delivery_range`

#### Scenario: List cut at the limit

- **WHEN** 230 cycles are to dispatch in the range
- **THEN** the queue lists 200, `truncated` is true and `next_from` is the delivery date of the 201st

#### Scenario: Boxes already sent do not take places

- **WHEN** the range has 250 paid cycles, 120 of them already delivered or on the road, and 130 to dispatch
- **THEN** "A despachar" lists the 130 and `truncated` is false

#### Scenario: Long on the road

- **WHEN** a delivery has been out for delivery since a cycle whose delivery date is 40 days ago
- **THEN** the queue still lists it under out for delivery

#### Scenario: Out for delivery outside the range

- **WHEN** a delivery is out for delivery for a cycle delivered in four days and the queue is read without a range
- **THEN** the queue still lists it under out for delivery

#### Scenario: Old failure

- **WHEN** a delivery failed 40 days ago and the invoice has no active delivery
- **THEN** the queue lists it under failed and not under to dispatch

#### Scenario: Failed then dispatched again

- **WHEN** a delivery failed and the invoice was dispatched again
- **THEN** the queue lists the invoice only under out for delivery

#### Scenario: Delivered window

- **WHEN** one delivery was delivered 6 civil days ago in São Paulo and another 8 civil days ago
- **THEN** the queue lists the first under delivered and not the second

#### Scenario: Zero-subtotal cycle

- **WHEN** a Brazil subscription skipped a cycle and its paid invoice has subtotal zero
- **THEN** the queue does not list that cycle, because a skipped cycle never becomes a paid production cycle

### Requirement: Queue rows show who receives

Each queue row MUST show the recipient name, neighborhood, city, ZIP, delivery date, production status and subscription status. The recipient is the subscription address `recipient_name`. Without one, the row MUST show the name the production queue shows for that subscription.

#### Scenario: Recipient set

- **WHEN** a subscription address holds recipient "João Lima" and the account is Ana Costa
- **THEN** the row shows "João Lima"

#### Scenario: Old subscription

- **WHEN** the subscription address has no recipient
- **THEN** the row shows the same name as the production queue

### Requirement: Dispatching an order that is not ready needs confirmation

Dispatching a cycle whose production status is not `ready`, or whose subscription is not `active` or `trialing`, MUST be refused with HTTP 409 and code `courier_dispatch_needs_confirmation` unless the request confirms it. The panel MUST show a second confirmation that names the reason.

#### Scenario: Production not ready

- **WHEN** an operator dispatches a cycle in production status `in_production` without confirming
- **THEN** the API returns 409 and no record is stored

#### Scenario: Confirmed

- **WHEN** the operator confirms the same dispatch
- **THEN** the record is stored as out for delivery

### Requirement: The subscription detail shows its courier deliveries

The admin subscription detail of a Brazil subscription MUST show its recipient, by the same rule as the queue rows, and every courier delivery of the subscription, newest first. Each delivery shows status, method, courier, tracking link, cost, note, failure reason and stage dates, plus the actions the actor's permissions allow. The UPS section MUST NOT be shown.

#### Scenario: Brazil subscription with a failed attempt

- **WHEN** an operator opens a Brazil subscription whose last cycle failed once and was delivered on the second attempt
- **THEN** both deliveries are listed, the failed one with its reason

### Requirement: Store shows the courier delivery timeline

For each paid Brazil delivery cycle, the store plan history MUST show three stages in order: in preparation, out for delivery and delivered. In preparation is reached when the invoice is paid. The other two take their dates from the active delivery. A failed delivery with no new active one MUST show as a warning on in preparation. A canceled delivery MUST NOT show. A tracking link MUST be shown when the active delivery has one, even though a courier delivery has no tracking number. The method, cost, note, reason and staff MUST NOT be shown. Texts MUST follow the site language.

#### Scenario: On the road with a link

- **WHEN** a customer opens the plan history while the delivery is out for delivery with a tracking link
- **THEN** in preparation and out for delivery are reached with dates, delivered is pending, and the link is shown

#### Scenario: Failed attempt

- **WHEN** the only delivery of the cycle failed
- **THEN** in preparation is the current stage and shows that the delivery could not be completed

#### Scenario: UPS history unchanged

- **WHEN** a customer opens the plan history of a US plan with a UPS shipment
- **THEN** the tracking number, the link and the four UPS stages show as before

#### Scenario: Paid with no delivery yet

- **WHEN** the cycle is paid and no delivery was registered
- **THEN** only in preparation is reached

### Requirement: A failed delivery records what kind of failure it was

Marking a delivery as failed MUST accept an optional `failure_kind` of `address_unusable`, `customer_absent` or `other`, beside the required free-text reason. Any other value MUST answer `422 invalid_courier_field` with field `failure_kind`, and nothing changes. The kind MUST be returned with the delivery and recorded in the `courier_delivery.failed` audit event. A failure without a kind MUST keep working as before.

#### Scenario: Address does not work

- **WHEN** an operator marks a delivery on the road as failed with `failure_kind: "address_unusable"` and reason "Portaria não aceita entrega"
- **THEN** the delivery is failed, carries both the kind and the reason, and the audit event names the kind

#### Scenario: Unknown kind

- **WHEN** the body carries `failure_kind: "lost"`
- **THEN** the API returns 422 with field `failure_kind` and the delivery stays on the road

#### Scenario: Older client

- **WHEN** the body carries only the reason
- **THEN** the delivery is failed with no kind

### Requirement: Queue rows carry what the dispatch needs

Each queue row MUST also carry the subscription delivery address (street, number, complement, neighborhood, city, state, ZIP), the account phone, the delivery instructions kept in the customer's profile address, and the cycle's flavors and packs as the production queue shows them. Missing values MUST come as `null` (or an empty list for items). The row MUST say that the instructions come from the profile. These fields MUST follow the route's permission and market scope and MUST NOT appear anywhere else.

#### Scenario: Complete row

- **WHEN** a paid Brazil cycle has a full address, the account has phone "+55 11 98888-7777" and the profile holds instructions "Interfone 12"
- **THEN** its row carries the full address, that phone, those instructions marked as from the profile, and the cycle's flavors and packs

#### Scenario: No phone

- **WHEN** the account has no phone
- **THEN** the row carries `phone: null` and the rest as usual

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

### Requirement: The courier queue lists only the Brazil market

The courier queue and the Today count of Brazil boxes to dispatch MUST include a paid cycle only when its subscription's shipping market is BR.

#### Scenario: Crossed cycle

- **WHEN** a subscription with account `us` and address country `BR` has a paid cycle
- **THEN** the courier queue does not list it and the Today count does not count it

### Requirement: A dispatch needs a complete Brazil address

A dispatch MUST be refused with HTTP 422 and code `courier_address_incomplete` when the subscription address lacks the street, number, neighborhood, city, state, an 8-digit CEP or the recipient name. The response MUST list the failing codes in `issues`. `confirm_not_ready` MUST NOT bypass it. Each field MUST accept the aliases already stored (`street`, `line1`, `address_line1`; `zipcode`, `postal_code`).

#### Scenario: No neighborhood

- **WHEN** an operator dispatches a cycle whose address has no neighborhood, with `confirm_not_ready: true`
- **THEN** the API returns 422 `courier_address_incomplete` with `issues` containing `address_neighborhood_missing`, and nothing is stored

#### Scenario: Complete address

- **WHEN** the address has every field and a recipient name
- **THEN** the dispatch follows the usual readiness rule

### Requirement: Queue rows show what the address lacks

Each row under to dispatch and failed MUST carry `issues`, the codes the dispatch check would refuse, empty when the address passes.

#### Scenario: Row without a number

- **WHEN** a to-dispatch cycle's address has no number
- **THEN** its row has `issues: ["address_number_missing"]`
