# Spec Delta

## ADDED Requirements

### Requirement: A paid invoice is handled only on its subscription's account

When `invoice.paid` arrives for a subscription already stored with a Stripe account, the API MUST handle it only on that account's webhook endpoint. On the other endpoint it MUST respond 200, MUST NOT update the subscription, record an NF-e, issue or email an Eden Bowls invoice, or send a letter, and MUST log a warning with reason `account_mismatch`. A subscription not stored yet MUST be handled on the endpoint that delivered the event.

#### Scenario: Brazil subscription event on the United States endpoint

- **WHEN** a subscription is stored as `br` and its `invoice.paid` arrives on `POST /stripe/v1/webhook/us`
- **THEN** the API responds 200, writes no ledger, NF-e or invoice row, sends no email, and logs `account_mismatch`

#### Scenario: Same event on the subscription's own endpoint

- **WHEN** the same `invoice.paid` arrives on `POST /stripe/v1/webhook/br`
- **THEN** the API handles it and issues one Eden Bowls invoice with account `br`

#### Scenario: One sandbox behind both endpoints

- **WHEN** local development forwards one `invoice.paid` of a `br` subscription to both endpoints
- **THEN** exactly one Eden Bowls invoice exists for that Stripe invoice

#### Scenario: Subscription not stored yet

- **WHEN** `invoice.paid` arrives for a subscription with no stored row
- **THEN** the API handles it with the account of the endpoint that delivered it
