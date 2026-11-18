# Spec Delta

## ADDED Requirements

### Requirement: Starter invites are sent by a scheduled tick

A `starter_invites` job with its own lock MUST run hourly and MUST send at most 100 invites per tick, oldest Day 1 first. A Starter that does not qualify MUST NOT use that limit. It MUST record the Day 1 used and its source with each sent invite, MUST NOT change Stripe or the ledger, and one failed Starter MUST NOT stop the others. A failed send MUST be tried again on the next tick. It MUST log scanned, sent, skipped and failed counts.

#### Scenario: One Starter fails

- **WHEN** the mailer reports a failure for one Starter
- **THEN** the other Starters are processed, the log shows at least one failed, and that invite is tried again on the next tick

#### Scenario: Sent from the expected date

- **WHEN** a tick sends an invite for a Starter whose Day 1 is expected
- **THEN** the claim records Day 1 and the source `expected`
