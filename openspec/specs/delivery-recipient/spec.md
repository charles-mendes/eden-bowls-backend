# delivery-recipient Specification

## Purpose

Defines the name of the person who receives a delivery, kept apart from the account holder, so labels and couriers address the box to the right person in both markets.

## Requirements

### Requirement: A recipient name has one validation rule

A recipient name MUST be trimmed with inner spaces collapsed, then MUST be 2 to 60 characters, MUST contain at least one Unicode letter (`\p{L}`), and MUST NOT contain `@`. A single word is valid. This rule is separate from the fiscal name rule and MUST NOT require two words. An invalid name MUST be answered with HTTP 422 and field `recipient_name`, and nothing is saved.

#### Scenario: Single word and accents

- **WHEN** the recipient is "José", "Portaria" or "  Ana   Costa  "
- **THEN** it is accepted and stored as "José", "Portaria" and "Ana Costa"

#### Scenario: Digits only

- **WHEN** the recipient is "12"
- **THEN** the API returns 422 with field `recipient_name`

#### Scenario: Email-like

- **WHEN** the recipient is "a@b"
- **THEN** the API returns 422 with field `recipient_name`

#### Scenario: Length limits

- **WHEN** the recipient has 60 characters, then 61 characters, then only spaces
- **THEN** the first is accepted and the other two return 422

### Requirement: Checkout collects the recipient name

The checkout delivery address in both markets MUST have a required recipient name field. It MUST be pre-filled from the saved address recipient when there is one, otherwise from the account display name when that name is not empty and is not an email. The customer MUST be able to change it. Saving the checkout address (`POST /api/v1/onboarding/address`) MUST refuse a missing or empty recipient with 422, because that call replaces the whole saved address.

#### Scenario: Pre-filled from the account

- **WHEN** a customer whose account name is "Ana Costa" and whose saved address has no recipient reaches the address step
- **THEN** the recipient field shows "Ana Costa" and can be edited

#### Scenario: Account name is an email

- **WHEN** the account display name is "ana@example.com"
- **THEN** the recipient field starts empty

#### Scenario: Checkout address without the field

- **WHEN** the checkout address is saved without `recipient_name`
- **THEN** the API returns 422 with field `recipient_name` and the saved address is unchanged

### Requirement: The recipient is stored apart from the account name

The recipient MUST be stored with the delivery address as its own field and copied into the subscription address at checkout. It MUST NOT be copied to the Stripe customer or shipping name, the account name, or any address key that email greetings read. Changing the recipient MUST NOT change the account name, and changing the account name MUST NOT change the recipient. Email greetings MUST stay as they are today.

#### Scenario: Gift to another person

- **WHEN** Ana Costa checks out with recipient "João Lima"
- **THEN** the subscription address holds "João Lima", the account name is still "Ana Costa", and no letter greets "João"

### Requirement: Checkout refuses an address without a recipient

Starting a subscription MUST be refused with HTTP 422 and code `recipient_name_required` when the saved delivery address has no valid recipient name. No Stripe call MUST be made.

#### Scenario: Old saved address

- **WHEN** a customer whose saved address predates this change confirms payment without passing the address step again
- **THEN** the API returns 422 `recipient_name_required`, Stripe is not called, and the store sends the customer back to the address step

### Requirement: Editing an address keeps an omitted recipient

The profile delivery address, the admin user delivery form and the subscription address edit MUST accept the recipient with the same rule. In these three, a request without the recipient field MUST keep the stored recipient, and an empty string MUST be refused with 422. This holds for the subscription edit too, even though it sends the whole address. A profile edit MUST change the address for the next checkout only. A subscription edit MUST change only that subscription.

#### Scenario: Subscription street change without the field

- **WHEN** a customer changes the street of a subscription whose recipient is "João Lima" and the request has no recipient field
- **THEN** the subscription address has the new street and still holds "João Lima"

#### Scenario: Subscription recipient change

- **WHEN** a customer changes the recipient of an active subscription to "Portaria Ed. Sol"
- **THEN** that subscription's next UPS label or courier delivery uses "Portaria Ed. Sol", and its other subscriptions and the profile address are unchanged

#### Scenario: Profile edit only

- **WHEN** a customer changes the recipient in the profile delivery address
- **THEN** existing subscriptions keep their recipient

#### Scenario: Admin save without the field

- **WHEN** the admin saves a user delivery without the recipient field
- **THEN** the stored recipient is unchanged

#### Scenario: Empty string

- **WHEN** a profile edit sends `recipientName: ""`
- **THEN** the API returns 422 and the stored recipient is unchanged

### Requirement: The UPS label uses the recipient name

The UPS label ship-to name and attention name MUST be the subscription recipient, cut to the 35 characters UPS accepts. When the subscription has no recipient, the label MUST keep today's fallback: an address name, then the account display name when it is not an email. A label with no usable name MUST still be blocked with `recipient_name_missing`.

#### Scenario: Label with a recipient

- **WHEN** an operator buys a label for a subscription whose recipient is "João Lima" and whose account name is "Ana Costa"
- **THEN** the label is addressed to "João Lima"

#### Scenario: Subscription from before the change

- **WHEN** the subscription address has no recipient and the account name is "Ana Costa"
- **THEN** the label is addressed to "Ana Costa"

#### Scenario: Long name

- **WHEN** the recipient has 48 characters
- **THEN** the label carries its first 35 characters

### Requirement: Operation screens show the recipient name

The production queue and the admin subscription detail MUST show the subscription recipient first. Without one, each MUST keep the name it shows today: the production queue falls back to the customer email.

#### Scenario: Queue with a recipient

- **WHEN** a paid cycle's subscription address holds "João Lima"
- **THEN** the production queue shows "João Lima"

#### Scenario: Queue for an old subscription

- **WHEN** the subscription address has no recipient
- **THEN** the production queue shows the customer email, as today

### Requirement: Tax documents keep the buyer

The NF-e and the Eden Bowls invoice MUST keep naming the buyer, using the name they use today (fiscal name or account name), and MUST NOT use the recipient name.

#### Scenario: NF-e of a gift

- **WHEN** the NF-e is issued for a subscription whose recipient differs from the buyer
- **THEN** the NF-e names the buyer
