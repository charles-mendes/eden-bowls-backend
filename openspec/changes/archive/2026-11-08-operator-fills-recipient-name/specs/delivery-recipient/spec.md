## ADDED Requirements

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

## MODIFIED Requirements

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
