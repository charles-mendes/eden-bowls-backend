# delivery-address-issues Specification

## Purpose

Tracks, per subscription, a delivery address or fiscal data that stops a box or a note from leaving, tells the customer once by email what to fix, and closes itself when the customer saves data that passes.

## Requirements

### Requirement: An address problem opens only on an event

An address problem MUST open only on one of these events: a paid cycle whose address fails its market's check (`payment_check`), a courier dispatch refused for the address (`courier_check`), a label purchase refused by an address check (`ups_check`), a courier failure recorded with `failure_kind: address_unusable` (`courier_failed`), or an NF-e blocked for a missing CPF or fiscal name (`nfe_check`). Reading a queue, a detail or Today's counts MUST NOT open one, nor MUST a change of production status, including marking a cycle `ready` while its address would be refused at dispatch; the operator sees the lock and decides, and the customer is told only on one of the events above. A market exception MUST NOT open one on any event.

#### Scenario: Dispatch refused

- **WHEN** an operator dispatches a Brazil cycle whose address has no number
- **THEN** the dispatch is refused and an address problem opens with source `courier_check` and code `address_number_missing`

#### Scenario: Queue read

- **WHEN** the courier queue lists a cycle whose address has no number and no problem is open
- **THEN** no problem opens and no email is sent

#### Scenario: Failure with another kind

- **WHEN** a courier failure is recorded with `failure_kind: customer_absent`
- **THEN** no address problem opens

#### Scenario: Crossed dispatch

- **WHEN** a dispatch is refused with `shipment_market_exception`
- **THEN** no address problem opens and no email is sent

#### Scenario: Marked ready with an address held

- **WHEN** an operator marks `ready` a paid Brazil cycle whose address has no recipient name and no problem is open
- **THEN** no address problem opens and no email is sent, and the production queue item shows `courierIssues: ["recipient_name_missing"]`

#### Scenario: Today and the subscription detail

- **WHEN** Today counts that cycle in `courierAddressLocked` and an operator opens its subscription detail with `courier_issues`
- **THEN** no address problem opens and no email is sent

#### Scenario: Dispatch tried afterwards

- **WHEN** an operator then tries to dispatch that cycle
- **THEN** the dispatch is refused and an address problem opens with source `courier_check`, as before

### Requirement: Every event reports everything still wrong

Each event MUST report the full set of codes true at that moment: the address codes of the subscription's shipping market and, in Brazil, `tax_document_missing` and `fiscal_name_missing`. A courier failure with `address_unusable` MUST add `courier_address_unusable` to that set.

#### Scenario: One payment, two checks

- **WHEN** a Brazil cycle is paid with no neighborhood and no fiscal name, and both the NF-e and the payment checks run
- **THEN** one problem opens with `address_neighborhood_missing` and `fiscal_name_missing`, and one email is sent

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

When the customer saves a subscription address, or a CPF and fiscal name, every open problem of that account MUST be checked again, because the fiscal data belongs to the account. A problem with nothing left MUST close with `resolved_by: customer`. When an operator fills the recipient of a subscription in the panel, the open problem of that subscription MUST be checked again the same way and, with nothing left, MUST close with `resolved_by: operator`. A problem with codes left MUST stay open with only those codes, and MUST NOT send an email. Saving a new address MUST clear `courier_address_unusable`.

#### Scenario: Customer fixes the address

- **WHEN** the customer saves the address with the missing number
- **THEN** the problem closes, and the next dispatch of that cycle is allowed

#### Scenario: Save still incomplete

- **WHEN** a problem lists a missing number and a missing CPF, and the customer saves only the number
- **THEN** the problem stays open with only the CPF code and no email is sent

#### Scenario: Fiscal name saved on another subscription

- **WHEN** a customer with two Brazil subscriptions, each with a problem for the missing fiscal name, saves the fiscal name in one of them
- **THEN** both problems close

#### Scenario: Operator fills the recipient

- **WHEN** a problem lists only `recipient_name_missing` and an operator fills the recipient of that subscription
- **THEN** the problem closes with `resolved_by: operator` and no email is sent

#### Scenario: Operator fills the recipient with other codes left

- **WHEN** a problem lists `recipient_name_missing` and a missing number, and an operator fills the recipient
- **THEN** the problem stays open with only the missing number and no email is sent

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

### Requirement: The email always goes out once

The email MUST NOT depend on the automated email settings. A send failure MUST be logged, MUST leave the problem without `email_sent_at`, and MUST NOT be retried by a job.

#### Scenario: SMTP down

- **WHEN** the SMTP server refuses the email of a new problem
- **THEN** the problem stays open without `email_sent_at` and no job sends it later

### Requirement: Existing blocks open no problem at deploy

The deploy MUST NOT open problems or send emails for cycles already blocked. A cycle already blocked MUST open its problem on its next event.

#### Scenario: Blocked before the deploy

- **WHEN** a cycle had an incomplete address before the deploy and nobody dispatches it
- **THEN** no problem opens and no email is sent

### Requirement: A problem closes when the subscription ends with nothing left to ship

An open address problem MUST close with `resolved_by: ended` when its subscription is `canceled` (Stripe `canceled` or `incomplete_expired`) and has no paid cycle whose box has not left. A cycle not paid yet MUST NOT keep it open. A box has left when the cycle's invoice has a courier delivery on the road or delivered, or a UPS label created or delivered. The rule MUST be checked when Stripe reports the subscription changed, after a courier dispatch and after a UPS label is created. Closing MUST NOT send an email.

#### Scenario: Canceled after the last box was delivered

- **WHEN** a subscription whose only paid cycle was delivered by courier, with an open problem for `recipient_name_missing`, is canceled in Stripe
- **THEN** the problem closes with `resolved_by: ended`, no email is sent, and Today no longer counts it

#### Scenario: Canceled with a paid box still to leave

- **WHEN** a subscription with an open problem is canceled while a paid cycle has no courier delivery and no UPS label
- **THEN** the problem stays open

#### Scenario: Last box leaves after the cancellation

- **WHEN** that canceled subscription's last paid cycle is then dispatched by courier, or gets a UPS label created
- **THEN** the problem closes with `resolved_by: ended`

#### Scenario: Cycle not paid yet

- **WHEN** a canceled subscription's only paid cycle was delivered and it also has a cycle with no payment
- **THEN** the problem closes with `resolved_by: ended`

#### Scenario: Failed delivery

- **WHEN** a canceled subscription's last paid cycle has only a failed courier delivery
- **THEN** the problem stays open

#### Scenario: Active subscription with every box delivered

- **WHEN** an active subscription with an open problem has every paid cycle delivered
- **THEN** the problem stays open, because the next cycle needs the address

#### Scenario: No problem open

- **WHEN** a subscription with no open problem ends
- **THEN** nothing opens and nothing is recorded

### Requirement: Open problems of ended subscriptions close at deploy

The deploy MUST close, with `resolved_by: ended`, every open problem that already meets the rule of the requirement above, and MUST NOT send an email. Problems that do not meet it MUST stay open, unchanged.

#### Scenario: Problem left open by an earlier cancellation

- **WHEN** the deploy runs and a canceled subscription, whose only paid cycle was delivered, has a problem open since before the deploy
- **THEN** that problem closes with `resolved_by: ended` and no email is sent

#### Scenario: Problem of an active subscription

- **WHEN** the deploy runs and an active subscription has an open problem
- **THEN** that problem stays open
