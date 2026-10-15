# Spec Delta

## Purpose

Lets checkout and renewals bill shipping on the US and BR Stripe accounts without a shipping product id in the environment.

## ADDED Requirements

### Requirement: Shipping product ids are not environment configuration

The API MUST start and serve checkout and renewals when `STRIPE_US_SHIPPING_PRODUCT_ID`, `STRIPE_SHIPPING_PRODUCT_ID`, and `STRIPE_BR_SHIPPING_PRODUCT_ID` are absent. The API MUST NOT read those variables to choose a Stripe shipping product. A leftover value in the process environment MUST NOT change which product a subscription uses.

#### Scenario: Boot without shipping product variables

- **WHEN** the API starts with Stripe US and Stripe BR otherwise configured and the three shipping-product variables unset
- **THEN** startup succeeds and neither account is given a shipping product id from the environment

#### Scenario: Leftover variable is ignored

- **WHEN** the process environment still sets `STRIPE_SHIPPING_PRODUCT_ID` or an account-specific shipping product id
- **THEN** checkout and `invoice.created` do not use that value

### Requirement: Checkout records a shipping product on the same Stripe account

When a subscription is created with a shipping amount greater than zero, the API MUST attach the shipping charge to a Stripe product on the same account that owns the subscription (US or BR). The product MUST be named `Shipping` and use tax code `txcd_92010001` when the API creates it. The API MUST store that product id on the subscription as `shipping_product_id`, together with `shipping_amount_minor` and `shipping_currency`. The first invoice MUST include that shipping amount. A product id from the other Stripe account MUST NOT be used.

#### Scenario: US checkout creates and records shipping

- **WHEN** a US subscription is created with a positive shipping quote and the US client has no shipping product yet
- **THEN** the API creates a `Shipping` product on the US account, puts its id in `shipping_product_id`, and includes the shipping amount on the first invoice

#### Scenario: BR checkout stays on the BR account

- **WHEN** a BR subscription is created with a positive shipping quote
- **THEN** the shipping product is created or reused on the BR account and the subscription metadata stores that BR product id

#### Scenario: Later checkout in the same process reuses the account product

- **WHEN** another subscription with positive shipping is created on the same account after a shipping product was already resolved in that process
- **THEN** the API reuses that product id and still writes it to the new subscription's `shipping_product_id`

#### Scenario: Zero shipping does not require a product

- **WHEN** a subscription is created with no shipping cost
- **THEN** the API does not create a shipping product and does not set `shipping_product_id`

#### Scenario: Stripe cannot create the shipping product

- **WHEN** subscription creation has a positive shipping amount and Stripe rejects creation of the shipping product
- **THEN** the API does not create the subscription and returns a shipping failure to the caller

### Requirement: Renewals use the stored shipping product

On `invoice.created` for a draft invoice whose billing reason is `subscription_cycle`, the shipping product id MUST come only from the subscription metadata `shipping_product_id`. The API MUST NOT use an id cached on the process, injected into the webhook service, or left in the environment. The amount MUST come from `shipping_amount_minor` when that value is positive, and otherwise from the stored ledger shipping cost. When the amount is greater than zero and the metadata id is a `prod_` id, the API MUST add one shipping invoice item with that id. When the amount is greater than zero and the metadata id is missing or not a `prod_` id, the API MUST NOT add a shipping item and MUST log a warning that names the subscription and the Stripe account and does not include payment details. When the shipping amount is zero, the handler MUST NOT add a shipping item, MUST NOT create a shipping product, and MUST NOT log that warning.

#### Scenario: Renewal uses the stored product id

- **WHEN** a draft `subscription_cycle` invoice arrives for a subscription whose metadata has a positive `shipping_amount_minor` and a `shipping_product_id`, even if the process has cached a different shipping product id
- **THEN** the API adds the shipping invoice item with the metadata product id

#### Scenario: Ledger supplies the amount when metadata amount is missing

- **WHEN** a draft `subscription_cycle` invoice arrives, subscription metadata has no positive shipping amount, the ledger has a positive shipping cost, and metadata has a `shipping_product_id`
- **THEN** the API adds the shipping invoice item using the ledger amount in minor units and that metadata product id

#### Scenario: Renewal with no stored product id adds no shipping line

- **WHEN** a draft `subscription_cycle` invoice arrives with a positive shipping amount and the subscription has no `shipping_product_id`, even if the process has cached a shipping product id
- **THEN** the API does not add a shipping invoice item and logs a warning for that subscription and account

#### Scenario: Renewal with no shipping is a no-op

- **WHEN** a draft `subscription_cycle` invoice arrives and both metadata and the ledger have no positive shipping amount
- **THEN** the API does not add a shipping invoice item, does not create a shipping product, and does not log a missing-product warning

### Requirement: Go-live records the skipped shipping line

The production go-live checklist MUST state that a renewal with a positive shipping amount and no `shipping_product_id` adds no shipping line, and that this must be reviewed before production. It MUST also state that more than one `Shipping` product can exist for an account after a process restart or after two first checkouts for that account run at the same time.

#### Scenario: Checklist names the skip

- **WHEN** an operator reads the production go-live checklist
- **THEN** it tells them to review subscriptions that have a positive shipping amount and no `shipping_product_id` before production
