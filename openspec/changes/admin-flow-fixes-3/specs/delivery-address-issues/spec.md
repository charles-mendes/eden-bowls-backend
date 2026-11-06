## Purpose

Tracks, per subscription, a delivery address or fiscal data that stops a box or a note from leaving, tells the customer once by email what to fix, and closes itself when the customer saves data that passes.

## ADDED Requirements

### Requirement: An address problem opens only on an event

An address problem MUST open only on one of these events: a paid cycle whose address fails its market's check (`payment_check`), a courier dispatch refused for the address (`courier_check`), a label purchase refused by an address check (`ups_check`), a courier failure recorded with `failure_kind: address_unusable` (`courier_failed`), or an NF-e blocked for a missing CPF or fiscal name (`nfe_check`). Reading a queue or a detail MUST NOT open one.

#### Scenario: Dispatch refused

- **WHEN** an operator dispatches a Brazil cycle whose address has no number
- **THEN** the dispatch is refused and an address problem opens with source `courier_check` and code `address_number_missing`

#### Scenario: Queue read

- **WHEN** the courier queue lists a cycle whose address has no number and no problem is open
- **THEN** no problem opens and no email is sent

#### Scenario: Failure with another kind

- **WHEN** a courier failure is recorded with `failure_kind: customer_absent`
- **THEN** no address problem opens

### Requirement: One open problem per subscription and one email per problem

A subscription MUST have at most one open address problem. An event with the same set of codes as the open problem MUST change nothing and send nothing. An event with another set MUST close the open problem as superseded and open a new one. Each new problem MUST send one email to the account email, claimed once by the problem.

#### Scenario: Second dispatch attempt

- **WHEN** a dispatch is refused again for the same missing number
- **THEN** the open problem is kept and no second email is sent

#### Scenario: Another field missing

- **WHEN** the customer adds the number but the next dispatch is refused for a missing neighborhood
- **THEN** the old problem closes as superseded, a new one opens with `address_neighborhood_missing`, and one new email is sent

### Requirement: The email says what to fix and where

The email MUST be in pt-BR for account `br` and en-US for account `us`, MUST list in plain words what is missing or refused, and MUST link to `/dashboard/plans/<stripe subscription id>/edit?step=address` on the store. A missing CPF or fiscal name MUST link to the same step.

#### Scenario: Brazil email

- **WHEN** a problem opens for account `br` with `address_neighborhood_missing`
- **THEN** the customer gets one pt-BR email naming the neighborhood and linking to the address step of that subscription

### Requirement: Saving data that passes closes the problem

When the customer saves a subscription address, or a CPF and fiscal name, and that subscription's data now passes every check of its problem, the problem MUST close with `resolved_by: customer`. A save that still fails MUST keep it open.

#### Scenario: Customer fixes the address

- **WHEN** the customer saves the address with the missing number
- **THEN** the problem closes, and the next dispatch of that cycle is allowed

#### Scenario: Save still incomplete

- **WHEN** a problem lists a missing CPF and the customer saves only an address change
- **THEN** the problem stays open

### Requirement: The panel shows the problem and the email state

The courier queue rows, the UPS label queue rows, the admin subscription detail and the admin NF-e detail MUST carry the subscription's `address_issue`: codes, source, opened, email sent and resolved times, or `null` when there is none open or resolved in the last 30 days.

#### Scenario: Blocked row

- **WHEN** a to-dispatch row has an open problem whose email went out on 3 November
- **THEN** the row has `address_issue` with its codes and `email_sent_at` on 3 November

### Requirement: Address problems follow the privacy rules

The privacy export MUST include the account's address problems, with codes, source and dates. Deleting the account MUST delete them.

#### Scenario: Export

- **WHEN** a customer with one resolved problem asks for the export
- **THEN** the export lists the problem with its codes and dates

### Requirement: Existing blocks open no problem at deploy

The deploy MUST NOT open problems or send emails for cycles already blocked. A cycle already blocked MUST open its problem on its next event.

#### Scenario: Blocked before the deploy

- **WHEN** a cycle had an incomplete address before the deploy and nobody dispatches it
- **THEN** no problem opens and no email is sent
