# Spec Delta

## ADDED Requirements

### Requirement: Plan notices are sent by a scheduled tick

A `plan_notices` job with its own lock MUST run hourly and MUST send at most 100 notices per tick, with the nearest period end first. A candidate that is already notified or does not qualify MUST NOT use that limit, and the tick MUST continue until it has sent 100 or run out of candidates. It MUST read the market settings at each run, MUST NOT change Stripe or the ledger, and one failed subscription MUST NOT stop the others. It MUST log scanned, sent, skipped, and failed counts, and a mailer result reporting a failed send MUST count as failed.

#### Scenario: More notices than one tick allows

- **WHEN** 150 subscriptions qualify
- **THEN** one tick sends 100 and the next tick sends the remaining 50

#### Scenario: Earliest candidates were already notified

- **WHEN** the 100 nearest period ends were already notified and a further subscription qualifies
- **THEN** that subscription is sent in the same tick

#### Scenario: One subscription fails

- **WHEN** the send reports a failure for one subscription
- **THEN** the other subscriptions are processed, the log shows a failed count of at least one, and that notice is tried again on the next tick

#### Scenario: Preview fails

- **WHEN** the Stripe preview fails for a renewal notice
- **THEN** the notice is sent without an amount and is not counted as failed

#### Scenario: Second process

- **WHEN** a tick is already running and another process starts the same job
- **THEN** the second tick does not call Stripe or SMTP
