# Spec Delta

## Purpose

Defines Day 1 of a Starter, when the customer can confirm the monthly plan, and how the monthly checkout treats a customer who bought a Starter.

## ADDED Requirements

### Requirement: Day 1 is the Starter's delivery

Day 1 of a Starter MUST be the date its delivery was confirmed: the UPS delivered scan in the US, or the courier delivery marked delivered in BR, in the market's time zone. When no delivery is confirmed, Day 1 MUST be the expected delivery date of the Starter's paid cycle, once that date has come. Before both, the Starter has no Day 1. A delivery confirmed after the expected date MUST replace the expected Day 1 for anything not already sent.

#### Scenario: US delivery scanned

- **WHEN** a US Starter's UPS tracking reports delivered on 2026-12-03
- **THEN** its Day 1 is 2026-12-03, confirmed

#### Scenario: Courier did not mark the delivery

- **WHEN** a BR Starter's expected delivery date was 2026-12-03, today is 2026-12-04, and the courier delivery is still `out_for_delivery`
- **THEN** its Day 1 is 2026-12-03, expected

#### Scenario: Before delivery

- **WHEN** a Starter's expected delivery date is tomorrow and nothing was confirmed
- **THEN** it has no Day 1

### Requirement: The store knows the Starter's state

`GET /api/v1/subscriptions/:subscriptionId/detail` of a subscription with `plan_kind` `starter` MUST return a `starter` block with `day_one` (date or null), `day_one_source` (`confirmed`, `expected` or null), `monthly_open` (true from Day 1), `monthly_subscription_id` (the plan confirmed from it, or null), and `plan_prefill` with the Starter's pets, recipes and recipe proportions. A plan subscription MUST NOT return this block.

#### Scenario: Starter delivered

- **WHEN** the customer opens a Starter whose Day 1 has come
- **THEN** `starter.monthly_open` is true and `plan_prefill` lists the Starter's recipes and proportions

### Requirement: The monthly plan opens on Day 1

A monthly checkout (`plan_kind` `subscription`) by a customer whose only paid purchase is a Starter MUST be refused with HTTP 409 `starter_not_delivered` while that Starter has no Day 1. From Day 1, the checkout MUST be allowed for the Starter's pets: pets in a Starter MUST NOT count as subscribed, and the checkout MUST NOT reuse the Starter's checkout or subscription. The Starter MUST keep its own subscription and cycle. A monthly delivery arriving within the Starter's days MUST be accepted.

#### Scenario: Customer confirms on Day 2

- **WHEN** a customer's Starter was delivered yesterday and the customer checks out a 3-month plan with the same pets
- **THEN** a new subscription is created and charged at once, and the Starter is unchanged

#### Scenario: Customer tries before delivery

- **WHEN** a customer checks out a monthly plan before the Starter has a Day 1
- **THEN** the API returns 409 `starter_not_delivered` and nothing is charged

#### Scenario: Customer never confirms

- **WHEN** a Starter's period ends and the customer never checked out a plan
- **THEN** nothing is charged and no subscription is created
