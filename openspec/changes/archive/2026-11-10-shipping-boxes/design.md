# Design

## Context

- **Settings:** `shipping_us_settings` holds one `package` (12 × 12 × 12 in, 10 lb, `dry_ice_kg` 0.5). `UpsClient.buildPackage` turns it into one UPS package with the dry ice block (`ups-dry-ice-declaration`). Checkout quote, admin simulation, label and pickup all read it.
- **Shipments:** `ups_shipments` stores one `tracking_number` and one `label_path` per invoice, with at most one active row (migration `030`). `createShipment` reads only `PackageResults[0]`. `voidShipment` voids by `ups_shipment_id`, which UPS applies to every package of the shipment.
- **Packs of a cycle:** the production queue builds line items per cycle (`production-queue-presenter.js`). `cyclePacks` in `src/core/pack-stock.js` sums them per recipe and size, pets included, and the stock separation uses it. This is what the kitchen packs.
- **Pickup:** `ups-pickup.service.js` sends `settings.package.weight_lb` with the box count the panel sends.
- **Courier (BR):** `CourierDeliveryService.presentQueueItem` builds its own item and copies only `lineItems` from `presentProductionQueueItem`, so a new presenter field does not reach it by itself.
- **Pickup in the client:** `UpsClient.createPickup` sends `TotalWeight = weightLb × packageCount`, so the service passes one box's weight today.
- **Quote package:** the settings `package` defaults to 12 × 12 × 12 in and 10 lb (migration `013` and `DEFAULT_SETTINGS`).

## Goals / Non-Goals

**Goals:**
- One pure function decides the boxes of a cycle, and the queue, the courier list, the label and the pickup all use it.
- A label with several boxes is still one shipment per invoice, so the one-active-label rule, the batch purchase, tracking and the shipped letter keep working.

**Non-Goals:**
- Checkout quote by box (free shipping is open with the client). The quote keeps the settings `package`. Ops should set that `package` to the monthly box in the meantime.
- Starter Box purchase, the 5th-day email and its delivery-date rule (changes B and C).
- Tracking every package. Tracking follows the first package (risk below).

## Decisions

1. **Boxes live in a new `shipping_us_boxes` table (`key`, `label`, `length_in`, `width_in`, `height_in`, `empty_weight_kg`, `max_packs`), read and saved under `us.boxes`.** Dimensions and weights only matter to UPS, so they sit with the US settings. A BR cycle uses the same `max_packs` to count its boxes. The alternative, one table per market, would let the two markets disagree on the same physical box. Two fixed keys (`starter`, `monthly`) keep the rule readable. Adding a third box is a later change.
2. **`src/core/shipping-boxes.js` exports `planBoxes({ packs, boxes, dryIceKg })`.** It takes the `cyclePacks` output, sorts packs heaviest first and fills monthly boxes of `max_packs` while more than that remains, then puts the rest in the Starter box when it fits, otherwise in a monthly box. 45 → 30 + 15, 40 → 30 + 10, 12 → one monthly, 8 → one Starter. This minimises the number of boxes first and then uses the smaller box. Weight = pack grams + `empty_weight_kg` + `dryIceKg` (0 for BR). Pounds = kg × 2.20462, rounded up to one decimal, the precision UPS accepts.
3. **`ups_shipment_packages` (`shipment_id`, `sequence`, `box_key`, `pack_count`, `weight_lb`, `dry_ice_kg`, `tracking_number`, `label_path`), one row per package.** `ups_shipments.tracking_number` and `label_path` keep the first package, so every reader that predates this change still works. The alternative, a JSON column on `ups_shipments`, would make a package's label hard to find by sequence.
4. **`UpsClient.createShipment` takes `packages: [{ length_in, width_in, height_in, weight_lb, dry_ice_kg }]`** and sends `Package` as an array, every entry built by `buildPackage`. The response's `PackageResults` is read as an array in the same order. A single `package` keeps working for the empty-plan fallback and the simulation.
5. **The label service loads the cycle's line items for the invoice the same way the production queue does**, runs `cyclePacks` and `planBoxes`, then buys. Unsized lines are logged, as in the stock separation.
6. **Label route: `?package=N` (1-based) on the existing path**, so the route manifest and the panel contract do not change.
7. **Pickup weight: sum of `weight_lb` of the packages of `shipment_ids`**, or the settings `package` for a label without package rows. `createPickup` takes `totalWeightLb` and sends it as is, so it no longer multiplies by the count. `packageCount` stays the number of boxes the panel sends, defaulted to the number of packages.
8. **Courier items copy `boxes`** from the presenter in `presentQueueItem`, next to `lineItems`.
9. **The migration moves the quote `package` to the monthly box only when it still holds the old defaults** (12, 12, 12 and 10), and `DEFAULT_SETTINGS` uses the same values. The checkout then quotes the heaviest common box until the free-shipping answer, and a value an operator set is kept. 37.5 lb is the box's full weight, dry ice included, so the dry ice block is not added on top.

## Risks / Trade-offs

- [Tracking follows the first package; a second box can be late or lost while the shipment shows delivered] → Accepted for now. UPS returns every package on the lead tracking number, and a later change can read them all.
- [UPS refuses a package, for example a dry ice lane check, and the whole shipment fails] → The purchase fails like any refused label and stores nothing, as today.
- [Cycle line items differ from what the kitchen packed, for example a manual change after separation] → The plan is built when the label is bought, from the same lines the stock separation deducts.
- [Weights are estimates until the boxes are weighed] → `empty_weight_kg` is editable. UPS bills an adjustment when the declared weight is low, so pounds round up. A Starter of 10 × 500 g is 6.5 kg, sent as 14.4 lb where the client's table says 14.3 lb.

## Migration Plan

1. Migration `1700000000070` creates `shipping_us_boxes` with the two client boxes and `ups_shipment_packages`, and moves the quote `package` to the monthly box when it still holds the old defaults. Existing shipments get no package rows and keep reading `ups_shipments`. `down` drops both tables.
2. Deploy the API, then the panel change.
3. Rollback: revert the build and run `down`. Labels bought in between stay valid at UPS. Their extra package labels stay on disk.
