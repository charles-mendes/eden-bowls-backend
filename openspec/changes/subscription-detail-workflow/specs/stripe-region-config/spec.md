# Spec Delta

## ADDED Requirements

### Requirement: A paid invoice is handled only on its subscription's account

When `invoice.paid` arrives for a subscription already stored with a Stripe account, the API MUST handle it only on that account's webhook endpoint. On the other endpoint it MUST respond 200 and MUST NOT write anything for the event: no contract renewal, ledger, checkout reference, NF-e, production cycle, delivery counter, Eden Bowls invoice, letter or Stripe write. A subscription not stored yet MUST be handled on the endpoint that delivered the event.

#### Scenario: Brazil subscription event on the United States endpoint

- **WHEN** a subscription is stored as `br` and its `invoice.paid` arrives on `POST /stripe/v1/webhook/us`
- **THEN** the API responds 200 and the ledger, checkout reference, NF-e, production cycle, delivery counter and invoice rows are unchanged, no email is sent and no Stripe write is made

#### Scenario: Pending plan edit on the wrong endpoint

- **WHEN** the stored `br` subscription has a pending term change and its `invoice.paid` arrives on the `us` endpoint
- **THEN** no new contract is started and the pending edit stays pending

#### Scenario: Same event on the subscription's own endpoint

- **WHEN** the same `invoice.paid` arrives on `POST /stripe/v1/webhook/br`
- **THEN** the API handles it and issues one Eden Bowls invoice with account `br`

#### Scenario: One sandbox behind both endpoints

- **WHEN** local development forwards one `invoice.paid` of a `br` subscription to both endpoints
- **THEN** exactly one Eden Bowls invoice exists for that Stripe invoice

#### Scenario: Subscription not stored yet

- **WHEN** `invoice.paid` arrives for a subscription with no stored row
- **THEN** the API handles it with the account of the endpoint that delivered it

### Requirement: An ignored paid invoice is logged with what it belongs to

When a paid invoice is ignored for an account mismatch, the API MUST log a warning with reason `account_mismatch`, the endpoint's account, the stored account, the Stripe subscription id and the Stripe invoice id. The event MUST count as processed, so Stripe does not resend it.

#### Scenario: Subscription stored with the wrong account

- **WHEN** a subscription was stored as `us` by mistake and its legitimate `invoice.paid` arrives on the `br` endpoint
- **THEN** the event is ignored, and the warning names the subscription, the invoice and both accounts so the operator can find and fix it
