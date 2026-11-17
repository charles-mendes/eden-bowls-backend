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

The production queue, the Brazil courier list and the admin subscription detail MUST show the subscription recipient first. Without one, the production queue and the Brazil courier list MUST show the account name when it has one that is not an email and the customer profile is in the actor's markets (`customerProfileInScope`), and otherwise the customer email; the subscription detail MUST keep the name it shows today, the customer email. Each queue and courier item MUST carry `account_name` (`accountName` in the production queue), the account name or `null` when there is none, it is an email, or the profile is outside the actor's markets, and `name_source` (`nameSource` in the production queue), one of `recipient`, `account` or `email`, so the panel can mark a name that is not the recipient. The subscription detail MUST carry `account_name` by the same rule, only so the panel can suggest it. Showing the account name MUST NOT change any address rule: a subscription without a recipient is still refused by the courier dispatch.

#### Scenario: Queue with a recipient

- **WHEN** a paid cycle's subscription address holds "João Lima"
- **THEN** the production queue shows "João Lima"

#### Scenario: Queue for an old subscription

- **WHEN** the subscription address has no recipient and the account name is empty or an email
- **THEN** the production queue shows the customer email, as today

#### Scenario: Queue falls back to the account name

- **WHEN** the subscription address has no recipient and the account name is "Ana Costa"
- **THEN** the production queue and the courier list show "Ana Costa" with name source `account`, carry the account name "Ana Costa", and the courier dispatch still reports `recipient_name_missing`

#### Scenario: Subscription detail keeps the email

- **WHEN** the subscription address has no recipient and the account name of a profile in the actor's market is "Ana Costa"
- **THEN** the subscription detail still shows the customer email as the recipient line and carries `account_name` "Ana Costa" for the suggestion

### Requirement: Tax documents keep the buyer

The NF-e and the Eden Bowls invoice MUST keep naming the buyer and MUST NOT use the recipient name. The NF-e MUST use the fiscal name, and a customer without one MUST have the note blocked. The Eden Bowls invoice MUST use the name it uses today (fiscal name or account name).

#### Scenario: NF-e of a gift

- **WHEN** the NF-e is issued for a subscription whose recipient differs from the buyer
- **THEN** the NF-e names the buyer

#### Scenario: Buyer without a fiscal name

- **WHEN** a BR customer has no fiscal name and their cycle is paid
- **THEN** the NF-e is blocked instead of naming the account display name

### Requirement: A subscription address edit needs a recipient

A subscription edit that sends an address MUST be refused with HTTP 422 and code `recipient_name_required` when neither the request nor the stored address has a valid recipient name. An edit without an address MUST NOT be affected.

#### Scenario: Old subscription changes its street

- **WHEN** a customer of a subscription stored without a recipient sends a new street and no recipient
- **THEN** the API returns 422 `recipient_name_required` and nothing is saved

#### Scenario: Pack change on an old subscription

- **WHEN** the same customer changes only packs for one delivery
- **THEN** the edit is saved as today

### Requirement: The operator can fill the recipient of a subscription

`PATCH /api/v1/admin/billing/subscriptions/:id/recipient-name` with `{ recipient_name }` MUST let a user with `users.delivery.write` in the subscription's market set the recipient of that subscription. The name MUST follow the recipient validation rule. Only the recipient key of that subscription address MUST change: not the account name, the Stripe customer, the account delivery address or another subscription. The change MUST be audited with the subscription and the actor, without the name itself. The answer MUST hold the stored `recipient_name` and the `courier_issues` of the address after the change. An unknown subscription and a subscription outside the operator's market MUST both answer 404, as the record scope does. When the subscription address already has a recipient, the route MUST answer 409 `recipient_name_present` and save nothing: it fills a missing recipient and never replaces one. The recipient MUST stay with the subscription, so every later cycle of it reads the same name.

#### Scenario: Operator fills a missing recipient

- **WHEN** a Brazil operator sends "Ana Costa" for a Brazil subscription locked by `recipient_name_missing`
- **THEN** the subscription address holds "Ana Costa", `courier_issues` is empty, the account name is unchanged and the courier dispatch is allowed

#### Scenario: Invalid name

- **WHEN** the operator sends "12"
- **THEN** the API answers 422 with field `recipient_name` and nothing is saved

#### Scenario: Other market

- **WHEN** an operator scoped to the United States sends a name for a Brazil subscription
- **THEN** the API answers 404 and nothing is saved

#### Scenario: Recipient already present

- **WHEN** the subscription address already holds "João Lima" and the operator sends "Ana Costa"
- **THEN** the API answers 409 `recipient_name_present` and the address still holds "João Lima"

#### Scenario: Later cycles pass too

- **WHEN** the operator fills "Ana Costa" and the subscription's next cycle is paid
- **THEN** the courier dispatch of that next cycle reports no `recipient_name_missing`
