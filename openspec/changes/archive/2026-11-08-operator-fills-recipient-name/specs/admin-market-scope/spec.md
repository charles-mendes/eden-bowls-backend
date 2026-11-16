## MODIFIED Requirements

### Requirement: Nested customer payloads stay in the actor market

When returning a customer or onboarding detail, the system MUST include only nested billing, production, and shipment records whose canonical market is in the actor’s markets. When returning a billing or production item, identity fields MUST come from the ledger snapshot (email and address on the row), not a live profile join. The one exception is the account name of the operation screens (production queue, Brazil courier list, subscription detail and the queue search): it MAY be read live from the profile only when `customerProfileInScope` is true. When it is false, the item MUST carry no account name, MUST show the ledger email, and the queue search MUST NOT match that account name. The payload MUST indicate whether the linked customer profile is in the actor’s markets (`customerProfileInScope`).

#### Scenario: Brazil customer detail omits a US subscription

- **WHEN** an operator assigned `BR` opens a Brazil customer who also has a `stripe_account=us` subscription
- **THEN** the customer detail succeeds and the US subscription is absent from nested collections

#### Scenario: US subscription does not expose a Brazil profile as in-scope

- **WHEN** an operator assigned `US` loads that US subscription
- **THEN** `user.email` is the ledger `customer_email` and `customerProfileInScope` is false if the profile market is `BR`

#### Scenario: Account name of a profile in the actor's market

- **WHEN** a Brazil operator lists the production queue and a Brazil subscription with no recipient belongs to a profile in Brazil whose account name is "Ana Costa"
- **THEN** the item shows "Ana Costa" with name source `account` and carries the account name

#### Scenario: Account name of a profile in another market

- **WHEN** the same subscription belongs to a profile in the United States
- **THEN** the item shows the ledger email, carries no account name, and a search for "Costa" does not list it
