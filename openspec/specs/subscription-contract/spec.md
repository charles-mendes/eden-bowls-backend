# subscription-contract Specification

## Purpose

Defines what a subscription contract is, how its deliveries are counted, and what starts or ends one, so that plan-end dates, automatic endings, and notices agree.

## Requirements

### Requirement: Deliveries count toward the current contract

A contract MUST contain as many charged deliveries as its term in months. Only deliveries charged since the current contract started MUST count toward it. The total charged over the subscription's life MUST stay stored unchanged.

#### Scenario: First contract

- **WHEN** a three-month plan has 2 charged deliveries and no term change
- **THEN** its contract has 1 delivery left

#### Scenario: Renewal rolls into the next contract

- **WHEN** a three-month plan with renewal on has 3 charged deliveries and the next delivery is charged
- **THEN** a new contract is running with 2 deliveries left

### Requirement: A term change starts a new contract

Saving a different term MUST start a new contract with the full new term, counted from the next charge. Deliveries already charged MUST NOT reduce it. Saving the same term MUST NOT start a contract. An edit waiting for payment MUST start the contract only when that payment is confirmed.

#### Scenario: One month to three

- **WHEN** a one-month plan with 1 charged delivery changes to three months
- **THEN** the plan has 3 deliveries left

#### Scenario: Three months to six

- **WHEN** a three-month plan with 3 charged deliveries changes to six months
- **THEN** the plan has 6 deliveries left

#### Scenario: Four charged, then six

- **WHEN** a plan with 4 charged deliveries changes to six months
- **THEN** the plan has 6 deliveries left

#### Scenario: Shorter term

- **WHEN** a six-month plan with 2 charged deliveries changes to three months
- **THEN** the plan has 3 deliveries left

#### Scenario: Other edit

- **WHEN** a customer changes recipes and keeps the term
- **THEN** the count of the current contract does not change

#### Scenario: Edit waiting for payment

- **WHEN** a term change is pending payment
- **THEN** the current contract stays as it was until the invoice is paid, and then the new contract starts

### Requirement: Term change and a scheduled end

A term change on a plan ending because renewal was turned off MUST remove the scheduled end, so the new contract runs. Renewal MUST stay off, and the plan MUST end after the new contract's last delivery. A plan cancelled explicitly MUST stay cancelled.

#### Scenario: Renewal off after the last charge

- **WHEN** a plan with renewal off and a scheduled end changes to three months
- **THEN** the scheduled end is removed, 3 deliveries remain, and the end is scheduled again when the third is charged

#### Scenario: Explicit cancellation

- **WHEN** a plan cancelled by the customer changes term
- **THEN** the scheduled end stays

### Requirement: Contracting more

While a plan is active, the customer MUST extend it by changing the term or keeping renewal on, in the same subscription. After a plan has ended, contracting MUST create a new subscription. A pet covered by a live subscription MUST NOT enter a second one.

#### Scenario: A year of contracts for one dog

- **WHEN** a dog has contracts of 1, 3, 1, and 6 months in a row through term changes
- **THEN** each contract delivers its full term in the same subscription

#### Scenario: Buying again after the end

- **WHEN** a plan has ended and the customer contracts for the same dog
- **THEN** a new subscription is created with its own count

### Requirement: Edit shows what is due now

The review of a plan edit MUST show only the adjustment the edit itself creates, as a charge or a credit. The next regular invoice MUST NOT be presented as due now. Saving MUST invoice at once only when that adjustment is a charge.

#### Scenario: Term change alone

- **WHEN** a customer changes only the term
- **THEN** the review shows nothing due now, and saving creates no charge

#### Scenario: More packs

- **WHEN** an edit adds a pack mid-period and the adjustment is R$ 44,85
- **THEN** the review shows R$ 44,85 due now, not the next invoice plus that amount

#### Scenario: Fewer packs

- **WHEN** an edit removes a pack mid-period and the adjustment is a credit of R$ 44,84
- **THEN** the review shows the credit and no charge

### Requirement: An edit that needs card confirmation waits for it

When the invoice of an edit needs the customer to confirm the payment, the save MUST return its client secret and hold the edit as pending. A paid invoice MUST NOT hold the edit.

#### Scenario: Card requires authentication

- **WHEN** the edit's invoice is open and carries a confirmation secret
- **THEN** the store receives the secret and the edit stays pending until the invoice is paid

#### Scenario: Paid at once

- **WHEN** the edit's invoice is already paid
- **THEN** the edit applies without waiting

### Requirement: Edit review states the new contract

When an edit changes the term, the review MUST state that a new contract of that term starts at the next charge. It MUST NOT say that the billing cycle restarts. The next charge date MUST NOT change because of the term.

#### Scenario: Review of a term change

- **WHEN** a customer reviews a change to six months
- **THEN** the review states that a six-month contract starts at the next charge

#### Scenario: Next charge date

- **WHEN** a term change is saved
- **THEN** the next charge date is the same as before
