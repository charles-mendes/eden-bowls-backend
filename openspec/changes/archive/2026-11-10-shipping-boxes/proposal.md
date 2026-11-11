# Proposal

## Why

The system ships every order as one box of 12 × 12 × 12″ and 10 lb. The client defined two real boxes (docs-new/FEATURE_MEDIDAS_CAIXAS/Eden_Bowls_Medidas_e_Pesos.md) and decided that an order larger than one box ships in two or more boxes (eden-bowls-starter-box-e-assinaturas.md, section 2, and perguntas-resposta-claude.md, answers 8, 10 and 11):

- Starter box, 14 × 12 × 8″, up to 10 packs.
- Monthly box, 18 × 14 × 12″, up to 30 packs.
- The limit is the number of packs, whatever their size. The team picks the combination of boxes.
- Real weight = packs + 0.5 kg of dry ice (US only) + empty box (1.0 kg Starter, 1.5 kg monthly).
- Brazil: only the number of boxes, no dry ice. The courier uses an insulated box.

A monthly order of 30 × 500 g is 17 kg (37.5 lb) today declared to UPS as 10 lb, and a two-pet order of 45 packs has no way to ship.

## What Changes

- The US shipping settings hold the two boxes (dimensions, empty weight, maximum packs), editable in the admin through the existing `PUT /api/v1/admin/shipping/settings`.
- A box plan is computed for each paid cycle from the packs the kitchen separates: which boxes, how many packs in each, and each box's weight. The production queue and the courier deliveries return it.
- A UPS label buys one shipment with one package per box. Each package declares its weight, its box dimensions and 0.5 kg of dry ice. Each package label is stored and printable. Voiding voids them all.
- A UPS pickup weighs the sum of the packages of its labels.
- Out of scope: the checkout shipping quote. It keeps using the settings `package`, because free shipping is still open with the client. Starter Box purchase and the 5th-day email (changes B and C).

## Capabilities

### New Capabilities

- `shipping-boxes`: the box plan of a cycle (box choice, combination, weight per box) and where it is shown.

### Modified Capabilities

- `shipping-settings`: the US boxes are editable settings.
- `ups-label-queue`: a label is one shipment with one package per box.
- `ups-pickup`: the pickup weight is the sum of its packages.

## Impact

- New migration `1700000000070`: table `shipping_us_boxes` (seeded with the two boxes) and table `ups_shipment_packages`.
- New `src/core/shipping-boxes.js` (pure box plan).
- Edited: shipping settings entity, repository, normalizer and validator, `admin-shipping.service.js`, `ups-client.js` (`createShipment` with several packages), `ups-shipment.service.js`, `ups-shipment.repository.js`, `ups-pickup.service.js`, `production-queue-presenter.js`, `admin.routes.js` (label `?package=`).
- Admin panel sibling change `shipping-boxes` in `eden-bowls-admin`.
- `docs/api-routes.json` does not change: the label route keeps its path and gains a query parameter.
