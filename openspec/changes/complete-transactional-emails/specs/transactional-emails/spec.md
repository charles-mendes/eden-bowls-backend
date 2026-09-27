# Spec Delta

## Purpose

Enviar ao cliente e à operação as cartas de assinatura já desenhadas, uma vez por evento real, em pt-BR ou en-US conforme o mercado, sem derrubar a cobrança quando o SMTP falha.

## ADDED Requirements

### Requirement: First paid cycle confirms the order
When the first invoice of a subscription is paid, the system SHALL email the customer the existing order-confirmed letter and SHALL email operations the existing new-subscription letter. The customer recipient MUST be the ledger email, falling back to the invoice customer email. The operations recipients MUST be the configured ops list. An empty ops list MUST skip the internal letter without skipping the customer letter.

#### Scenario: First invoice paid
- **WHEN** an `invoice.paid` event has billing reason `subscription_create` and the subscription ledger has a customer email
- **THEN** the customer receives one order-confirmed letter for that invoice and each configured ops address receives one new-subscription letter for that invoice

#### Scenario: Ops list empty
- **WHEN** the first invoice is paid and no ops addresses are configured
- **THEN** the customer still receives the order-confirmed letter and no internal letter is sent

### Requirement: Approved payment reuses the charge letters
The system MUST NOT send a separate payment-approved letter. The first successful charge is the order-confirmed letter. A later successful subscription cycle is the renewal letter.

#### Scenario: Payment intent succeeds
- **WHEN** a `payment_intent.succeeded` event is processed for a subscription
- **THEN** no payment-approved letter is sent

### Requirement: Renewal receipt
When a later subscription cycle is paid, the system SHALL email the customer the existing renewal letter. The letter MUST include the charged total and MUST NOT be sent for the first invoice or for an invoice that only settles a plan edit.

#### Scenario: Cycle invoice paid
- **WHEN** an `invoice.paid` event has billing reason `subscription_cycle` and the ledger has a customer email
- **THEN** the customer receives one renewal letter for that invoice

#### Scenario: First invoice is not a renewal
- **WHEN** an `invoice.paid` event has billing reason `subscription_create`
- **THEN** the customer does not receive a renewal letter

### Requirement: Payment failure is one letter per invoice
The system SHALL email the customer the existing payment-failed letter when a subscription invoice payment fails. A payment-intent failure that belongs to the same invoice MUST NOT send a second letter. The letter MUST include the amount due and a link to the customer plan dashboard.

#### Scenario: Invoice payment fails
- **WHEN** an `invoice.payment_failed` event is processed for a subscription with a customer email
- **THEN** the customer receives one payment-failed letter for that invoice

#### Scenario: Matching payment intent also fails
- **WHEN** `invoice.payment_failed` and `payment_intent.payment_failed` both arrive for the same invoice
- **THEN** the customer receives only one payment-failed letter

### Requirement: Shipment letter stays on US tracking
The system SHALL email the customer the existing shipped letter when a UPS shipment is created with a tracking number. The letter MUST include the tracking number and a UPS tracking link. The system MUST NOT send that letter for a Brazil production-status change, because that queue has no shipped event and no tracking number.

#### Scenario: UPS label created
- **WHEN** a US shipment is stored with a tracking number and the subscription has a customer email
- **THEN** the customer receives one shipped letter for that shipment

#### Scenario: Brazil production advances
- **WHEN** an operator moves a Brazil subscription through the production queue
- **THEN** no shipped letter is sent

### Requirement: Pause, resume, and scheduled cancellation
The system SHALL email the customer the existing paused, resumed, or cancelled letter only when the Stripe subscription transitions into that state. Pause is `pause_collection` becoming set. Resume is `pause_collection` being cleared. Cancellation is `cancel_at_period_end` becoming true, including when the customer turns auto-renew off. Clearing `cancel_at_period_end` MUST NOT send a resumed letter. A later `customer.subscription.deleted` after a scheduled cancellation MUST NOT send a second cancelled letter. An immediate deletion without a prior scheduled-cancellation letter MUST send one cancelled letter.

#### Scenario: Customer pauses
- **WHEN** a subscription update sets `pause_collection` and the previous state was not paused
- **THEN** the customer receives one paused letter

#### Scenario: Customer resumes
- **WHEN** a subscription update clears `pause_collection` and the previous state was paused
- **THEN** the customer receives one resumed letter and does not receive an order-confirmed or renewal letter

#### Scenario: Customer schedules cancellation
- **WHEN** `cancel_at_period_end` changes from false to true
- **THEN** the customer receives one cancelled letter for that period end

#### Scenario: Auto-renew is turned back on
- **WHEN** `cancel_at_period_end` changes from true to false and the subscription is not leaving pause
- **THEN** no resumed letter and no cancelled letter is sent

#### Scenario: Period ends after a scheduled cancellation
- **WHEN** the subscription is deleted after a cancelled letter was already sent for that cancellation
- **THEN** the customer does not receive a second cancelled letter

### Requirement: Plan change letter
The system SHALL email the customer the existing plan-changed letter after a plan edit is applied to the ledger. If the edit waits for a payment, the letter MUST wait until that invoice is paid and MUST NOT also send an order-confirmed or renewal letter for that invoice. If the edit applies without a pending payment, the letter MUST be sent once for that edit. A subscription update that does not change the plan MUST NOT send this letter.

#### Scenario: Edit applies immediately
- **WHEN** a plan edit is committed and no payment confirmation is still pending
- **THEN** the customer receives one plan-changed letter for that edit

#### Scenario: Edit waits for payment
- **WHEN** a plan edit is stored as payment pending and the matching invoice is later paid
- **THEN** the customer receives one plan-changed letter and does not receive an order-confirmed or renewal letter for that invoice

### Requirement: Market language
Customer and operations letters MUST use pt-BR when the subscription Stripe account is Brazil or the delivery country is BR, and en-US otherwise. The same templates MUST serve both markets.

#### Scenario: Brazil subscription
- **WHEN** a letter is sent for a subscription on the Brazil Stripe account
- **THEN** the subject and body are Portuguese

#### Scenario: United States subscription
- **WHEN** a letter is sent for a subscription on the United States Stripe account with a non-BR delivery country
- **THEN** the subject and body are English

### Requirement: Failure, retry, and idempotency
A letter MUST be claimed once per subscription, template, and reference before send. A successful send MUST NOT be sent again for the same claim. A failed send MUST NOT be treated as a completed claim: the same reference MUST be eligible to send again. The sender MUST retry a failed SMTP attempt a small number of times in the same process and then stop. There MUST be no background job for mail. Mail failure MUST be logged with template and error code and MUST NOT fail the webhook acknowledgement, the subscription action, or the plan edit. Missing recipient, subscription, or reference MUST skip the letter and log the skip. A claim that was already sent MUST skip without calling SMTP.

#### Scenario: Duplicate paid invoice
- **WHEN** the same paid invoice is processed again after the order-confirmed letter was sent
- **THEN** SMTP is not called again

#### Scenario: SMTP fails then the same event is sent again
- **WHEN** SMTP fails for a claimed letter and the same subscription, template, and reference is attempted again
- **THEN** the system tries to send again instead of treating the failed claim as a duplicate

#### Scenario: SMTP is down during pause
- **WHEN** the pause letter exhausts in-process retries
- **THEN** the subscription remains paused, the failure is logged, and the customer action response still succeeds
