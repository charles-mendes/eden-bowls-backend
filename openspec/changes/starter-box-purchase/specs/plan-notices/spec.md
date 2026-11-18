# Spec Delta

## ADDED Requirements

### Requirement: A Starter gets no plan notice

A subscription with `plan_kind` `starter` MUST NOT receive the renewal notice or the plan-ending notice, even though its stored `auto_renew` is false and it is set to cancel at period end. The dashboard MUST NOT show a plan notice for it.

#### Scenario: Starter inside the notice window

- **WHEN** a paid Starter's period ends within the market's notice window
- **THEN** no plan-ending notice and no renewal notice is sent, and the dashboard shows no plan notice for it
