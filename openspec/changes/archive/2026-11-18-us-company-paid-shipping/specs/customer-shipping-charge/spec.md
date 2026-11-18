# Spec Delta

## Purpose

Defines what the customer pays for shipping in each market, how each subscription keeps the shipping condition it was checked out with, and what the company records as its own shipping cost.

## ADDED Requirements

### Requirement: New US checkouts follow the charge switch

A US checkout (plan or Starter) MUST read the US setting `charge_shipping` when it is placed. With `charge_shipping` on, the customer MUST pay the US quote, as before this change. With it off, the customer MUST pay 0: the checkout, preview and sales tax amounts MUST NOT include shipping, the first invoice MUST NOT carry a shipping item, and the checkout response MUST report `shipping_total` 0. The subscription MUST store the condition it was checked out with (`shipping_waived` true or false) and the quote as `shipping_original_minor`.

#### Scenario: Charges off

- **WHEN** `charge_shipping` is off and a US customer checks out a plan quoted at US$ 18.40
- **THEN** the first invoice has no shipping line, the response reports `shipping_total` 0, the sales tax is computed without shipping, and the subscription stores `shipping_waived` true with an original of 1840

#### Scenario: Charges on

- **WHEN** `charge_shipping` is on and a US customer checks out a plan quoted at US$ 18.40
- **THEN** the first invoice charges US$ 18.40 of shipping, as before this change, and the subscription stores `shipping_waived` false

#### Scenario: US Starter with charges off

- **WHEN** `charge_shipping` is off and a US customer checks out a Starter
- **THEN** the invoice has the discounted food and no shipping line

### Requirement: A subscription keeps its shipping condition

Renewals and plan edits of a US subscription MUST follow the condition the subscription was checked out with, whatever the current `charge_shipping`. A subscription checked out free MUST stay free on every renewal and edit. A subscription checked out with shipping charged MUST keep paying shipping as before, and an edit MUST price it with the quote of the edit. Subscriptions created before this change MUST read as charged.

#### Scenario: Switch turned on after a free checkout

- **WHEN** a US subscription was checked out with charges off and an operator later turns `charge_shipping` on
- **THEN** its next renewal has no shipping item and its edit preview shows shipping 0

#### Scenario: Switch turned off after a charged checkout

- **WHEN** a US subscription was checked out with charges on and an operator later turns `charge_shipping` off
- **THEN** its next renewal still charges its stored shipping amount

### Requirement: US quotes report the original and the charged amount

Every US quote response (`POST /shipping/v1/calculate`) and the stored shipping of a US subscription MUST carry `original_amount` (the quote), `charged_amount` (what the customer pays) and `charge_enabled`, in the quote's currency. With charges off, `charged_amount` MUST be 0 and `original_amount` the quote. A BR quote MUST carry `original_amount` and `charged_amount` both equal to the fee the customer pays, and `charge_enabled` true; a BR quote never has a struck amount. The store MUST be able to show the shipping from these fields alone.

#### Scenario: Quote with charges off

- **WHEN** `charge_shipping` is off and the UPS quote is US$ 18.40
- **THEN** the quote response has `original_amount` 18.40, `charged_amount` 0 and `charge_enabled` false

#### Scenario: BR quote

- **WHEN** a BR customer at 12 km is quoted R$ 15,00
- **THEN** the response has `original_amount` 15.00, `charged_amount` 15.00 and `charge_enabled` true

### Requirement: An unpaid US quote is kept as the company's cost

A US checkout MUST still require a valid signed delivery quote for the address, with charges on or off. When the customer does not pay the quote, it MUST be stored with the subscription as `company_cost`, with its currency and source (`ups`, `fixed` or `fallback`). The admin subscription detail MUST show it as the company's shipping cost.

#### Scenario: Cost recorded

- **WHEN** charges are off and a US checkout is quoted US$ 18.40 by UPS
- **THEN** the subscription's shipping has `company_cost` 18.40, currency USD, source `ups`, and the customer was charged 0

### Requirement: Brazil customers pay shipping as before

For a BR subscription (plan or Starter), the customer MUST pay one shipping fee per order by the BR rules (distance, rate, minimum and maximum) at checkout and on every renewal, as before this change, whatever the number of boxes. The US switch MUST NOT change any BR amount.

#### Scenario: BR checkout with US charges off

- **WHEN** US `charge_shipping` is off and a BR customer at 12 km checks out a plan whose delivery fits in one box
- **THEN** the shipping is the BR fee for 12 km, as before this change

#### Scenario: BR order of two boxes

- **WHEN** a BR customer at 12 km checks out a plan of 45 packs per delivery, which ships in two boxes
- **THEN** the shipping is one BR fee for 12 km, not two
