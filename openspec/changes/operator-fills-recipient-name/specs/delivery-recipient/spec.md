## ADDED Requirements

### Requirement: The operator can fill the recipient of a subscription

`PATCH /api/v1/admin/billing/subscriptions/:id/recipient-name` with `{ recipient_name }` MUST let a user with `users.delivery.write` in the subscription's market set the recipient of that subscription. The name MUST follow the recipient validation rule. Only the recipient key of that subscription address MUST change: not the account name, the Stripe customer, the account delivery address or another subscription. The change MUST be audited with the subscription and the actor, without the name itself. The answer MUST hold the stored `recipient_name` and the `courier_issues` of the address after the change. An unknown subscription MUST answer 404 and a subscription outside the operator's market 403.

#### Scenario: Operator fills a missing recipient

- **WHEN** a Brazil operator sends "Ana Costa" for a Brazil subscription locked by `recipient_name_missing`
- **THEN** the subscription address holds "Ana Costa", `courier_issues` is empty, the account name is unchanged and the courier dispatch is allowed

#### Scenario: Invalid name

- **WHEN** the operator sends "12"
- **THEN** the API answers 422 with field `recipient_name` and nothing is saved

#### Scenario: Other market

- **WHEN** an operator scoped to the United States sends a name for a Brazil subscription
- **THEN** the API answers 403 and nothing is saved

## MODIFIED Requirements

### Requirement: Operation screens show the recipient name

The production queue, the Brazil courier list and the admin subscription detail MUST show the subscription recipient first. Without one, each MUST show the account name when it has one that is not an email, and only then the customer email. Each item MUST also carry `account_name`, the account name or `null` when there is none or it is an email, so the panel can suggest it. Showing the account name MUST NOT change any address rule: a subscription without a recipient is still refused by the courier dispatch.

#### Scenario: Queue with a recipient

- **WHEN** a paid cycle's subscription address holds "João Lima"
- **THEN** the production queue shows "João Lima"

#### Scenario: Queue for an old subscription

- **WHEN** the subscription address has no recipient and the account name is empty or an email
- **THEN** the production queue shows the customer email, as today

#### Scenario: Queue falls back to the account name

- **WHEN** the subscription address has no recipient and the account name is "Ana Costa"
- **THEN** the production queue and the courier list show "Ana Costa", carry `account_name` "Ana Costa", and the courier dispatch still reports `recipient_name_missing`
