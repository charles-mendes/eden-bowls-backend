# Spec Delta

## Purpose

Defines the first-invoice discount percent of each subscription term and how the API reports it, so the admin panel and the checkout read the same value from one source.

## ADDED Requirements

### Requirement: Coupon health reports the percent of each term

The first-purchase coupon health response (`GET /api/v1/admin/stripe/first-purchase-promos`) MUST include a `terms` list with one entry per valid subscription term (1, 3 and 6 months), each with `subscription_term_months` and `discount_percent`. The percents MUST be the same values the checkout applies and the plan snapshot offers for that term. The admin panel MUST take the percent it shows for each term from this list and MUST NOT keep its own copy.

#### Scenario: Health lists the three terms

- **WHEN** an operator with `billing.coupons.write` reads the coupon health for BR
- **THEN** the response has `terms` with 1 → 10, 3 → 25 and 6 → 40, the same percents the plan snapshot returns in `plan_terms`

#### Scenario: Health without any mapped coupon

- **WHEN** no promotion code is mapped for the market and an operator reads the coupon health
- **THEN** the response still has `terms` with the three terms and their percents
