# Spec Delta

## Purpose

Defines how the Eden Bowls invoice that the customer receives prints the shipping of a charge, including a shipping the company paid.

## ADDED Requirements

### Requirement: The invoice says when shipping was free

The Eden Bowls invoice of a paid charge of a subscription stored with `shipping_waived` true MUST print the free label of the invoice's language as the value of the shipping row, in place of a zero amount, and its total MUST NOT include shipping. It MUST NOT print the company's cost. An invoice of a subscription that pays shipping MUST print the shipping amount, as before. The language follows the Stripe account, as for every invoice text: a US invoice is in English and prints "FREE". The Portuguese label "GRÁTIS" MUST exist so both languages carry every text, but no BR charge is free under this change. The layout MUST stay as approved: only the value of the shipping row changes.

#### Scenario: US invoice with free shipping

- **WHEN** the first invoice of a US subscription checked out with charges off is paid
- **THEN** its Eden Bowls invoice shows "Shipping: FREE" and a total of food and tax only

#### Scenario: US invoice with charged shipping

- **WHEN** a renewal of a US subscription checked out with charges on is paid with US$ 18.40 of shipping
- **THEN** the invoice shows "Shipping: $18.40"

#### Scenario: BR invoice

- **WHEN** a BR renewal with R$ 15,00 of shipping is paid
- **THEN** the invoice shows "Frete: R$ 15,00", as before
