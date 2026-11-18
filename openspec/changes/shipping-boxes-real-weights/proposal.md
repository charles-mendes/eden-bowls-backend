# Proposal

## Why

The client weighed the empty boxes (17/11/2026, docs-new/FEATURE_MEDIDAS_CAIXAS/decisoes-starter-box.md): Starter 355 g and monthly 600 g. The system uses the estimates of 1.0 kg and 1.5 kg, so every box is declared to UPS up to 0.9 kg heavier than it is. The column also stores only two decimals, so 0.355 kg cannot be saved, and the panel field steps by 0.1 kg. The client also asked that the system pick the most economical combination of boxes when an order goes over one box.

## What Changes

- Empty weights become 0.355 kg (Starter) and 0.600 kg (monthly) on deploy, unless an operator already changed them. The column keeps three decimals (grams).
- The panel accepts the empty weight to the gram (sibling change in `eden-bowls-admin`).
- The box plan rule is stated as the most economical one: fewest boxes first, then the smallest boxes. Each extra box adds an empty box, 0.5 kg of dry ice in the US and a UPS package charge, so one box less always costs less than any change of box size. The rule's results do not change; the requirement and its scenarios say why.
- UPS weights change: a US monthly box of 30 × 500 g goes from 17.0 kg (37.5 lb) to 16.1 kg (35.5 lb). A BR Starter of 10 × 300 g goes from 4.0 kg to 3.355 kg.
- Out of scope: the checkout quote package (it becomes the company cost quote in `us-company-paid-shipping` and stays editable), box dimensions, a third box size.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `shipping-boxes`: the economical combination rule and the weights with the weighed boxes.
- `shipping-settings`: deploy values of the boxes and empty weight to the gram.

## Impact

- New migration `1700000000088`: `shipping_us_boxes.empty_weight_kg` to DECIMAL(6,3), then Starter 1.00 → 0.355 and monthly 1.50 → 0.600 only where still at the old value.
- Edited: `DEFAULT_SETTINGS.us.boxes` in `src/infrastructure/shipping/shipping-settings.js`, `tests/shipping-boxes.test.js` expectations, `docs-new/FEATURE_MEDIDAS_CAIXAS/caixas-de-envio.md`.
- `src/core/shipping-boxes.js` keeps its algorithm. Only its comment and tests change.
- Sibling change `shipping-boxes-real-weights` in `eden-bowls-admin`. Deploy the API first.
