# Spec Delta

## Purpose

Defines what the panel's subscription detail page shows and in what order, so an operator sees how the current order stands, what needs attention, and the next step, without reading Stripe, Bling or courier data separately.

## ADDED Requirements

### Requirement: The page opens with the current cycle

For a reader with `shipping.read`, the top of the page MUST show the latest paid cycle: its stage (paid, in production, ready, out for delivery, delivered, delivery failed), its preparation and delivery dates, and the one next action the reader's permissions allow. It MUST show the next renewal date as a day, without the time. With no paid cycle it MUST say so.

#### Scenario: Brazil order out for delivery

- **WHEN** the latest paid cycle has a courier delivery out for delivery
- **THEN** the card shows "Em rota" with the dispatch date and offers "Marcar entregue" to a reader with `shipping.write`

#### Scenario: Cycle ready with no delivery yet

- **WHEN** the latest paid cycle is ready and has no courier delivery and no UPS label
- **THEN** the card shows it waits to be dispatched and offers the dispatch or label action of the subscription's market

#### Scenario: Reader without shipping access

- **WHEN** the reader lacks `shipping.read`
- **THEN** the card is not shown and the page still loads

### Requirement: The page lists what needs attention

The page MUST show, above the other sections, one entry per open problem: an NF-e refused or blocked, an open address problem, a courier lock, a failed delivery, and a mismatch between account and address country. Each entry MUST name the problem in plain words and the next step, with a link or action to it. With no open problem the block MUST NOT be shown.

#### Scenario: NF-e blocked for a missing field

- **WHEN** the subscription's NF-e is blocked with `missing_fields: ["fiscal_name"]`
- **THEN** the entry says the fiscal name is missing and links to the place where it is filled

#### Scenario: NF-e refused by Bling with named fields

- **WHEN** the NF-e is refused and `bling_problems` names fields
- **THEN** the entry lists those fields instead of Bling's generic message and links to the note

#### Scenario: Nothing open

- **WHEN** there is no open problem
- **THEN** no attention block is shown

### Requirement: Charges are grouped by Stripe invoice

The page MUST show one "Cobranças" section with one row per Stripe invoice the page knows, from the paid cycles, the Eden Bowls invoices, the NF-e list, and invoices fetched from Stripe on request. Each row MUST show the cycle date, the amount, and the state of the Eden Bowls invoice and of the NF-e, with their actions. Building the rows MUST NOT call Stripe. The Stripe id MUST be secondary text.

#### Scenario: Paid cycle with invoice and refused NF-e

- **WHEN** a paid cycle has an Eden Bowls invoice sent to the customer and a refused NF-e
- **THEN** one row shows the cycle date, the amount, "Enviada" with its download and resend actions, and the NF-e as refused with a link to the note

#### Scenario: Paid cycle without an Eden Bowls invoice

- **WHEN** a paid cycle has no Eden Bowls invoice and the reader has `billing.subscribers.sync`
- **THEN** its row offers "Gerar invoice" without fetching from Stripe first

#### Scenario: Older Stripe invoices

- **WHEN** the reader asks to fetch invoices from Stripe
- **THEN** invoices not already listed are added as rows and the existing rows stay

### Requirement: Emailing the customer needs confirmation

Sending or resending an Eden Bowls invoice to the customer MUST ask for confirmation naming the invoice number and the email address. Cancelling MUST send nothing.

#### Scenario: Resend cancelled

- **WHEN** the operator clicks "Reenviar" and cancels the confirmation
- **THEN** no email is sent and the row does not change

### Requirement: Action results appear where the action was taken

The result of an action MUST be shown in the section where the action was taken. A success message MUST clear on its own after a few seconds. An error MUST stay until the operator closes it or the next action in that section starts.

#### Scenario: Resend at the bottom of the page

- **WHEN** the operator resends an invoice from the charges section
- **THEN** the success message appears in that section, not only at the top of the page

### Requirement: Readable names come before technical ids

The page title MUST be the customer's name, with the email below it, and the email when there is no name. The plan MUST be described from the checkout copy (term, pets, packs) when the stored label is the `Plan #<id>` fallback. Stripe and price ids MUST appear only as secondary text or in the technical block. Links to the account and the checkout MUST say where they lead.

#### Scenario: Subscription with the fallback label

- **WHEN** the stored plan label is `Plan #6` and the checkout copy has a one-month term for one pet with 30 packs
- **THEN** the page describes the plan from that copy and does not show `Plan #6` as the product name

### Requirement: Brazil delivery shows charged freight and how to reach the customer

The Brazil delivery section MUST show the freight charged at checkout next to each delivery's courier cost, and the customer's phone next to the recipient when the address has one.

#### Scenario: Courier cost above the charged freight

- **WHEN** a delivery cost R$ 10,00 and the checkout charged R$ 2,47
- **THEN** both values are shown on that delivery

### Requirement: Actions stay visible on a narrow screen

At a viewport 390px wide, every delivery, label and charge action MUST be visible without horizontal scrolling, and the page MUST NOT scroll horizontally.

#### Scenario: Marking a delivery from a phone

- **WHEN** an operator opens a Brazil subscription with a delivery out for delivery at 390px
- **THEN** "Entregue", "Falhou" and "Cancelar" are visible without scrolling sideways

### Requirement: Equal totals are shown once

In the product details, the plan subtotal and the first invoice of the plan MUST be shown as one value when they are equal.

#### Scenario: Subtotal equals first invoice

- **WHEN** the plan subtotal and the first invoice are both R$ 1.327,50
- **THEN** the value appears once
