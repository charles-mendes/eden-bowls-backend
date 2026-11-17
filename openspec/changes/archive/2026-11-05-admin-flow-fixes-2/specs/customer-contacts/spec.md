## Purpose

Defines how the admin API records the contacts an operator makes with a customer outside the system (WhatsApp), so the next operator knows who spoke to the customer, when and with what result.

## ADDED Requirements

### Requirement: An operator records a contact on a subscription

`POST /api/v1/admin/billing/subscriptions/:id/contacts` MUST store a contact with the subscription, its customer and Stripe account, a `reason` (`payment_failed`, `late`, `delivery_failed`, `address`), an `outcome` (`no_answer`, `customer_will_fix`, `resolved`), an optional `note` of up to 500 characters after trimming, the acting operator and the time. The channel is always WhatsApp. Any other reason or outcome, or a longer note, MUST answer `422 invalid_contact` with the field, and nothing is stored. The route MUST require `customers.contact.write` and the subscription's market. The write MUST also record a `customers.contact.create` audit event without the note.

#### Scenario: Refused payment, no answer

- **WHEN** an operator records `reason: "payment_failed"`, `outcome: "no_answer"` on a past_due subscription
- **THEN** the contact is stored with the operator and the time, and the response returns it

#### Scenario: Unknown outcome

- **WHEN** the body carries `outcome: "angry"`
- **THEN** the API returns 422 with field `outcome` and nothing is stored

#### Scenario: Readonly

- **WHEN** a readonly user posts a contact
- **THEN** the API returns 403

### Requirement: Contacts are listed newest first

`GET /api/v1/admin/billing/subscriptions/:id/contacts` MUST return the subscription's contacts, newest first, up to 50, each with reason, outcome, note, operator name or e-mail, and time. It MUST require `billing.subscribers.read` and the subscription's market. Contacts MUST NOT be edited or deleted through the admin API.

#### Scenario: Two contacts

- **WHEN** a subscription has a contact from yesterday and one from today
- **THEN** the list returns today's first

### Requirement: The operator role can record contacts

`customers.contact.write` MUST be granted to `operator` and `admin`, and MUST NOT be granted to `readonly` or `veterinarian`.

#### Scenario: Operator permissions

- **WHEN** an operator loads `/admin/me`
- **THEN** the permissions include `customers.contact.write`

### Requirement: Contacts follow the customer's privacy requests

The customer's data export MUST include their contacts with reason, outcome, note and time, without the operator's e-mail. Erasing the customer's account MUST delete their contacts.

#### Scenario: Export

- **WHEN** a customer with one recorded contact requests an export
- **THEN** the package includes that contact with its note

#### Scenario: Erasure from a privacy request

- **WHEN** the customer's account is erased by a privacy request
- **THEN** no contact of that customer remains

#### Scenario: Deletion from the store

- **WHEN** the customer deletes the account in the store
- **THEN** no contact of that customer remains
