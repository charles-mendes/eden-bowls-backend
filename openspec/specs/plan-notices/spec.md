# plan-notices Specification

## Purpose

Tells customers ahead of time that a contract will renew or end, by email and in the customer dashboard, so a charge or the end of deliveries never comes as a surprise.

## Requirements

### Requirement: Renewal notice before a new contract

The system MUST email a renewal notice when a subscription is `active` or `trialing`, renewal is on, it is not set to cancel at period end, its period ends within the market's notice window, and the next charge starts a new contract. The window MUST run from now to now plus the configured days, so a period end in the past never qualifies.

#### Scenario: One-month plan

- **WHEN** a one-month plan with renewal on has its period ending in 7 days and the market window is 7 days
- **THEN** the customer receives one renewal notice

#### Scenario: Last paid delivery of a three-month contract

- **WHEN** a three-month plan with renewal on has 3 charged deliveries and its period ends inside the window
- **THEN** the customer receives one renewal notice

#### Scenario: Charge inside a contract

- **WHEN** a three-month plan with renewal on has 1 charged delivery and its period ends inside the window
- **THEN** no renewal notice is sent

#### Scenario: One-month plan without a stored count

- **WHEN** a one-month plan has no stored charged-delivery count and its period ends inside the window
- **THEN** the customer receives one renewal notice

#### Scenario: One-month plan with nothing charged

- **WHEN** a one-month plan has a stored count of 0
- **THEN** no renewal notice is sent, because there is no contract to renew yet

#### Scenario: Period end already passed

- **WHEN** the job was stopped and a period end is earlier than now
- **THEN** no notice is sent and `plan_notice` is null

#### Scenario: Charged deliveries unknown on a longer term

- **WHEN** a three-month plan has no stored charged-delivery count
- **THEN** no renewal notice is sent and the run counts it as skipped

#### Scenario: Subscription not in good standing

- **WHEN** the subscription is `past_due`, `paused`, or `canceled`
- **THEN** no renewal notice is sent

### Requirement: Renewal notice content

The renewal notice MUST state the renewal date and link to the plans page. It MUST state the `amount_due` of the subscription's next invoice as Stripe previews it, without any plan change in the preview, in the format of the other letters. It MUST be sent without an amount when that preview fails.

#### Scenario: Preview succeeds

- **WHEN** Stripe returns a preview of 89.90 BRL for the next invoice
- **THEN** the notice shows R$ 89,90

#### Scenario: Preview fails

- **WHEN** the Stripe preview fails or times out
- **THEN** the notice is sent without an amount and no charge or subscription change happens

### Requirement: Plan-ending notice before a contract ends

The system MUST email a plan-ending notice when a subscription is `active` or `trialing`, its stored `auto_renew` is false, it is set to cancel at period end, and its period ends within the market's notice window. A stored `auto_renew` that is true or empty MUST NOT receive this email. This notice MUST NOT request a Stripe preview.

#### Scenario: Renewal off after the last charge

- **WHEN** a plan with renewal off had its last contracted delivery charged and its period ends inside the window
- **THEN** the customer receives one plan-ending notice stating the end date and how to keep the plan

#### Scenario: Renewal off with deliveries still to charge

- **WHEN** a plan with renewal off is not yet set to cancel at period end
- **THEN** no plan-ending notice is sent

#### Scenario: Explicit cancellation

- **WHEN** the customer cancelled the plan and stored `auto_renew` is true or empty
- **THEN** no plan-ending notice is sent

### Requirement: Each notice goes out once per period

A notice MUST be sent at most once per subscription, notice type, and period end. A new period end MUST allow a new notice. A failed send MUST stay eligible and MUST be tried again while the subscription still qualifies.

#### Scenario: Next tick after a send

- **WHEN** a notice was sent and the subscription still qualifies on the next tick
- **THEN** SMTP is not called again

#### Scenario: Customer skips a delivery after the notice

- **WHEN** a renewal notice was sent and a skip moves the period end
- **THEN** a new notice is sent when the new period end enters the window

#### Scenario: SMTP fails

- **WHEN** the send fails and the subscription still qualifies on the next tick
- **THEN** the same notice is tried again

#### Scenario: Customer turns renewal off after a failed send

- **WHEN** a renewal notice failed and the subscription no longer qualifies on the next tick
- **THEN** that renewal notice is not sent

### Requirement: Notices follow the market language

Notices MUST use the same market language rule and designer shell as the other transactional letters, in PT for Brazil and EN for the United States, and MUST appear in the admin email preview.

#### Scenario: Brazilian subscription

- **WHEN** a notice is sent for a subscription of the BR account
- **THEN** the subject and body are in Portuguese and the date uses the Brazilian format

### Requirement: Dashboard shows the notice

The subscription list and detail MUST return `plan_notice` with `kind` (`renewal` or `ending`), `date` as the exact period end, and `days_left` (never negative), or null, without calling Stripe. The store MUST show it as a banner in Meu Plano and on the plan detail, formatting the date in the market's time zone. Any cancel at period end inside the window MUST show `ending`. That banner MUST state only the end date.

#### Scenario: Renewal inside the window

- **WHEN** a subscription qualifies for a renewal notice
- **THEN** the payload returns kind `renewal` and the store shows the renewal date with a link to the plan

#### Scenario: Email switched off

- **WHEN** the market has the notice email disabled and a subscription is inside the window
- **THEN** the banner still shows

#### Scenario: Explicit cancellation inside the window

- **WHEN** the customer cancelled and the period ends inside the window
- **THEN** the payload returns kind `ending` and the banner shows the end date with no invitation to turn renewal back on

#### Scenario: Same date as the letter

- **WHEN** the period ends at 01:00 UTC on a day that is still the previous day in Sao Paulo
- **THEN** the banner shows the same date as the BR letter

#### Scenario: Outside the window

- **WHEN** the period ends after the window
- **THEN** `plan_notice` is null and the store shows no banner
