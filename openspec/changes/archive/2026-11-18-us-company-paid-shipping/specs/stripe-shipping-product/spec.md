# Spec Delta

## ADDED Requirements

### Requirement: US renewals follow the subscription's shipping condition

On `invoice.created` for a draft `subscription_cycle` invoice of a subscription on the US Stripe account, the API MUST NOT add a shipping invoice item when the subscription metadata has `shipping_waived` true, whatever `shipping_amount_minor`, the stored ledger shipping cost or the current `charge_shipping` say, and MUST NOT log the missing-product warning. It MUST log once per invoice, at info level, that the shipping is paid by the company, with the subscription and without payment details. A US subscription without `shipping_waived`, or with it false, and every BR subscription MUST keep the existing rule.

#### Scenario: Free US subscription renews

- **WHEN** a draft renewal invoice arrives for a US subscription with `shipping_waived` true and `charge_shipping` is now on
- **THEN** no shipping item is added and the invoice charges only the food

#### Scenario: US subscription created before the change

- **WHEN** a draft renewal invoice arrives for a US subscription with no `shipping_waived`, a positive `shipping_amount_minor` and a `shipping_product_id`
- **THEN** the shipping item is added as before

#### Scenario: BR renewal

- **WHEN** a draft renewal invoice arrives for a BR subscription with a positive `shipping_amount_minor` and a `shipping_product_id`
- **THEN** the shipping item is added as before
