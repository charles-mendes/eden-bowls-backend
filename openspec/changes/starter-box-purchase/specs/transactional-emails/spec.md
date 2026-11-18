# Spec Delta

## ADDED Requirements

### Requirement: A Starter does not get the scheduled-cancellation letter

A subscription with `plan_kind` `starter` is created to end at its period end. That `cancel_at_period_end`, and the deletion at the period end, MUST NOT send the cancelled letter. The order-confirmed letter of its first paid invoice MUST be sent as for a plan, and MUST say it is a Starter of the market's Starter days with no automatic monthly charge.

#### Scenario: Starter is created

- **WHEN** a Starter subscription is created with `cancel_at_period_end` true and its first invoice is paid
- **THEN** the customer receives the order-confirmed letter for a Starter and no cancelled letter

#### Scenario: Starter period ends

- **WHEN** the Starter subscription is deleted at its period end
- **THEN** no cancelled letter is sent
