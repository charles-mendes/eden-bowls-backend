# admin-subscription-detail Specification

## Purpose

Defines what the panel's subscription detail page shows and in what order, so an operator sees how the current order stands, what needs attention, and the next step, without reading Stripe, Bling or courier data separately.

## Requirements

### Requirement: The header names the customer and the subscription state

The page title MUST be the account name the API returns (`account_name`), or the customer's email when it is empty. The line below the title MUST show the email when the title is a name, the subscription status, the next renewal as a day without the time, and, when the subscription cancels at period end, the day it ends. The note that pause and cancel are done by the customer in the store MUST stay.

#### Scenario: Customer in the operator's market

- **WHEN** the API returns `account_name: "Charles Mendes"` for an active subscription renewing on 2026-12-02
- **THEN** the title is "Charles Mendes" and the line below shows the email, "Ativo" and "renova em 02/12/2026"

#### Scenario: Customer outside the operator's market

- **WHEN** the API returns no `account_name`
- **THEN** the title is the customer's email

#### Scenario: Cancelling at period end

- **WHEN** the subscription cancels at period end
- **THEN** the line below the title says it ends on that day instead of saying it renews

### Requirement: The current cycle is the oldest one not delivered

The current cycle MUST be the oldest paid cycle whose box has not been delivered. When every paid cycle was delivered, it MUST be the newest delivered one. A cycle counts as delivered when its courier delivery is delivered or its active UPS shipment is delivered.

#### Scenario: Next month already paid while this month is on the road

- **WHEN** the November cycle is out for delivery and the December cycle is paid and to prepare
- **THEN** the current cycle is November

#### Scenario: Every cycle delivered

- **WHEN** every paid cycle was delivered
- **THEN** the current cycle is the newest one

### Requirement: The current cycle card shows its stage and next action

For a reader with `shipping.read`, the top of the page MUST show the current cycle's stage, its preparation and delivery dates, and the next action the reader's permissions allow, by this order: a delivery or UPS shipment decides the stage first, then production. UPS stages MUST come from the shipment the page loads (its status and tracking status). With no paid cycle the card MUST say so. Without `shipping.read` the card MUST NOT be shown.

| Source | State | Stage shown | Next action |
|---|---|---|---|
| Courier | `delivered` | Entregue | none |
| Courier | `out_for_delivery` | Em rota | Entregue, Falhou |
| Courier | `failed` | Entrega falhou | Despachar de novo |
| UPS | `delivered`, or tracking `delivered` | Entregue | none |
| UPS | `created`, tracking `out_for_delivery` | Saiu para entrega | Atualizar rastreio |
| UPS | `created`, tracking `in_transit` | Em trânsito | Atualizar rastreio |
| UPS | `created`, tracking `exception` or `returned` | Problema na entrega | Atualizar rastreio, contato com o cliente |
| UPS | `created`, no tracking or `label_created` | Aguardando coleta | Imprimir etiqueta |
| UPS | `pending` or `unknown` | Verificar na UPS | Fechar após conferir na UPS |
| Production | `ready` | Pronto para sair | Despachar (Brazil) or Gerar etiqueta UPS (United States) |
| Production | `in_production` | Em preparo | none |
| Production | `to_prepare` | A preparar | none |
| Production | `blocked` | Produção bloqueada | link to the production queue |

#### Scenario: Brazil order out for delivery

- **WHEN** the current cycle has a courier delivery out for delivery and the reader has `shipping.write`
- **THEN** the card shows "Em rota" with the dispatch date and offers "Entregue" and "Falhou"

#### Scenario: UPS box in transit

- **WHEN** the current cycle's active UPS shipment is `created` with tracking status `in_transit`
- **THEN** the card shows "Em trânsito" with the tracking number

#### Scenario: Production blocked

- **WHEN** the current cycle has no shipment and its production status is `blocked`
- **THEN** the card shows "Produção bloqueada" with a link to the production queue

#### Scenario: More paid cycles waiting

- **WHEN** the current cycle is November and the December cycle is also paid and not delivered
- **THEN** the card says one more paid cycle is waiting

#### Scenario: Reader without shipping write

- **WHEN** the reader has `shipping.read` but not `shipping.write` and the cycle is ready
- **THEN** the card shows "Pronto para sair" and no action button

#### Scenario: Reader without shipping access

- **WHEN** the reader lacks `shipping.read`
- **THEN** the card is not shown and the page still loads

### Requirement: The page lists what needs attention

The page MUST show, above the other sections, one entry per open problem: an NF-e refused, in error or blocked, an open address problem (`open: true`), a courier lock, a failed delivery, and a mismatch between account and address country. Each entry MUST name the problem in plain words and the next step, with a link or action. A closed address problem MUST NOT appear. With no open problem the block MUST NOT be shown.

#### Scenario: NF-e blocked for a missing field

- **WHEN** the subscription's NF-e is blocked with `missing_fields: ["fiscal_name"]`
- **THEN** the entry says the fiscal name is missing, that the customer corrects it in the store, and links to the note

#### Scenario: NF-e refused by Bling with named fields

- **WHEN** the NF-e is refused and `bling_problems` names fields
- **THEN** the entry lists those fields instead of Bling's generic message and links to the note

#### Scenario: Older API without the new NF-e fields

- **WHEN** the NF-e list item has no `missing_fields` and no `bling_problems`
- **THEN** the entry shows the note's status and last error and links to the note

#### Scenario: Address problem resolved recently

- **WHEN** the address problem the API returns has `open: false`
- **THEN** no entry is shown for it

#### Scenario: Nothing open

- **WHEN** there is no open problem
- **THEN** no attention block is shown

### Requirement: Attention entries point to the section that holds the problem

An open address problem MUST keep its own section, with the customer contact action, and its attention entry MUST link to that section. The mismatch between account and address country MUST be shown only as an attention entry, with a link to market exceptions.

#### Scenario: Open address problem

- **WHEN** the address problem is open
- **THEN** the attention entry links to the "Problema de endereço" section, which still offers the contact action

#### Scenario: Account and address country differ

- **WHEN** the subscription is a market exception
- **THEN** the page shows it once, as an attention entry linking to market exceptions

### Requirement: Charges are grouped by Stripe invoice

The page MUST show one "Cobranças" section, reachable at the `#faturas-stripe` anchor, with one row per Stripe invoice the page knows from the paid cycles, the Eden Bowls invoices, the NF-e list, and invoices fetched from Stripe on request. Each row MUST show the cycle date, the amount, the state of the Eden Bowls invoice and of the NF-e with their actions, and "PDF Stripe". Building the rows MUST NOT call Stripe. The Stripe id MUST be secondary text.

#### Scenario: Paid cycle with invoice and refused NF-e

- **WHEN** a paid cycle has an Eden Bowls invoice sent to the customer and a refused NF-e
- **THEN** one row shows the cycle date, the amount, "Enviada" with its download and resend actions, the NF-e as refused with a link to the note, and "PDF Stripe"

#### Scenario: Paid cycle without an Eden Bowls invoice

- **WHEN** a paid cycle has no Eden Bowls invoice and the reader has `billing.subscribers.sync`
- **THEN** its row offers "Gerar invoice" without fetching from Stripe first

#### Scenario: Older Stripe invoices

- **WHEN** the reader asks to fetch invoices from Stripe
- **THEN** invoices not already listed are added as rows and the existing rows stay

#### Scenario: Link from another screen

- **WHEN** the customer page or an NF-e links to `/billing/subscriptions/:id#faturas-stripe`
- **THEN** the page scrolls to the charges section

### Requirement: A charge row shows one amount

The row's amount MUST be the Eden Bowls invoice total when there is one, else the amount paid that Stripe returned, converted from minor units and shown with its currency, else "—".

#### Scenario: Only the Stripe invoice is known

- **WHEN** a fetched Stripe invoice has `amountPaid: 132997` in `brl` and no Eden Bowls invoice
- **THEN** the row shows R$ 1.329,97

### Requirement: Two Eden Bowls invoices for one Stripe invoice share a row

When two Eden Bowls invoices exist for one Stripe invoice, the row MUST show the one whose account is the subscription's account, and MUST name the other invoice's number and account in the same row, with its download.

#### Scenario: Local duplicate from both endpoints

- **WHEN** `EB-2026-000010` (`br`) and `EB-2026-000011` (`us`) exist for one Stripe invoice of a `br` subscription
- **THEN** the row shows `EB-2026-000010` and notes that `EB-2026-000011` was also issued for account `us`

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

The plan MUST be described from the checkout copy (term, pets, packs) when the stored label is the `Plan #<id>` fallback. Stripe subscription and price ids MUST appear only as secondary text or in the technical block. Links to the account and the checkout MUST say where they lead.

#### Scenario: Subscription with the fallback label

- **WHEN** the stored plan label is `Plan #6` and the checkout copy has a one-month term for one pet with 30 packs
- **THEN** the page describes the plan from that copy and does not show `Plan #6` as the product name

### Requirement: Brazil delivery shows charged freight and how to reach the customer

The Brazil delivery section MUST show the freight charged at checkout, the subscription's single shipping cost, next to each delivery's courier cost, and the customer's phone next to the recipient when the address has one.

#### Scenario: Courier cost above the charged freight

- **WHEN** a delivery cost R$ 10,00 and the checkout charged R$ 2,47 for freight
- **THEN** that delivery shows both values

### Requirement: Actions stay visible on a narrow screen

At a viewport 390px wide, every delivery, label and charge action MUST be visible without horizontal scrolling, and the page MUST NOT scroll horizontally.

#### Scenario: Marking a delivery from a phone

- **WHEN** an operator opens a Brazil subscription with a delivery out for delivery at 390px
- **THEN** "Entregue", "Falhou" and "Cancelar" are visible without scrolling sideways

### Requirement: Equal totals are shown once

In the product details, when the plan subtotal and the first invoice of the plan are equal, the page MUST show one value labelled "Subtotal do plano".

#### Scenario: Subtotal equals first invoice

- **WHEN** the plan subtotal and the first invoice are both R$ 1.327,50
- **THEN** only "Subtotal do plano: R$ 1.327,50" is shown
