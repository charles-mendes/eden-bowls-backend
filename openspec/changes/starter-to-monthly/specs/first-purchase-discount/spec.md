# Spec Delta

## ADDED Requirements

### Requirement: No first-purchase discount after a Starter

A customer who has a paid Starter MUST NOT get the first-purchase discount on any plan: the first charge MUST be the plan's regular price, and the plan snapshot `plan_terms` MUST report `discount_percent` 0 for every term with eligibility reason `STARTER_PURCHASED`. A customer who subscribes without a Starter MUST keep the first-purchase discount of the term, as before. The two discounts MUST NOT be combined.

#### Scenario: Monthly after a Starter

- **WHEN** a customer with a paid Starter checks out a 6-month plan in BR
- **THEN** no first-purchase coupon is applied and the first invoice is the plan's regular price plus shipping

#### Scenario: Direct subscription

- **WHEN** a new customer with no Starter checks out a 6-month plan in BR
- **THEN** the first invoice has the 40 percent first-purchase discount, as before

#### Scenario: Plan page after a Starter

- **WHEN** a customer with a paid Starter opens the plan
- **THEN** `plan_terms` show 0 percent for 1, 3 and 6 months
