# Spec Delta

## ADDED Requirements

### Requirement: Term percents are stored per Stripe account

The first-invoice discount percent MUST be stored per Stripe account (`br`, `us`) and subscription term (1, 3, 6), as an integer from 1 to 90. The deploy MUST store 10, 25 and 40 for terms 1, 3 and 6 in both accounts. The checkout, the plan snapshot `plan_terms` and the coupon health `terms` MUST read these stored values for the market's account. The two accounts MUST NOT share values.

#### Scenario: Values after deploy

- **WHEN** the migration runs and a customer opens the plan in BR
- **THEN** `plan_terms` offers 10, 25 and 40 percent for 1, 3 and 6 months, as before the deploy

#### Scenario: Accounts are independent

- **WHEN** the US 6-month percent is 35 and the BR one is 40
- **THEN** the US checkout of a 6-month plan applies 35 and the BR checkout applies 40

### Requirement: Changing a term percent creates a new coupon

`POST /api/v1/admin/stripe/first-purchase-coupons` MUST accept `percent_off` from 1 to 90; without it, the stored percent of the term MUST be used. A value outside the range MUST be refused with HTTP 422 `invalid_percent_off`. When Stripe creates the coupon and its promotion code, the API MUST map the new promotion code to the term and store `percent_off` as the term's percent, in that order, so a failed Stripe call changes nothing. The previous coupon MUST stay in Stripe, so existing subscriptions keep it. The change MUST require `billing.coupons.write` and MUST be recorded in the admin audit log as `billing.first_purchase.percent.update` with the account, the term, and the old and new percents.

#### Scenario: Raise the 3-month percent in BR

- **WHEN** an operator creates a BR 3-month coupon with `percent_off` 30
- **THEN** the new promotion code is mapped to 3 months in BR, the BR 3-month percent is 30, new checkouts of a 3-month plan in BR get 30, and the previous coupon still exists in Stripe

#### Scenario: Stripe refuses the coupon

- **WHEN** Stripe returns an error while creating the coupon
- **THEN** the mapping and the stored percent are unchanged and the API returns the Stripe error

#### Scenario: Percent out of range

- **WHEN** an operator sends `percent_off` 95
- **THEN** the API returns 422 `invalid_percent_off` and nothing is created in Stripe

### Requirement: Coupon health reports a percent mismatch

The coupon health MUST mark a slot with `percent_mismatch: true`, and include the coupon's `percent_off`, when the mapped coupon's percent in Stripe differs from the stored percent of that term. A matching or missing coupon MUST be reported with `percent_mismatch: false`.

#### Scenario: Coupon mapped by hand with another percent

- **WHEN** the BR 1-month slot is mapped to a promotion code whose coupon gives 15 percent and the stored BR 1-month percent is 10
- **THEN** the health reports the 1-month slot with `percent_mismatch: true` and `percent_off` 15
