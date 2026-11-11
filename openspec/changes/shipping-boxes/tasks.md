# Tasks

Admin sibling change: `shipping-boxes` in `eden-bowls-admin`. Deploy the API first.

## 1. Boxes in the settings

- [ ] 1.1 Add migration `1700000000070-create-shipping-boxes.js`. It creates `shipping_us_boxes`, seeded with `starter` (Starter Box, 14 × 12 × 8, 1.0 kg, 10) and `monthly` (Caixa mensal, 18 × 14 × 12, 1.5 kg, 30), and `ups_shipment_packages` with a foreign key to `ups_shipments` and a unique (`shipment_id`, `sequence`). It also updates `shipping_us_settings` to 18 × 14 × 12 and 37.5 lb only where the package is still 12 × 12 × 12 and 10. `down` drops both tables and leaves the package as it is. Register it in `src/infrastructure/db.js`, and set the same values in `DEFAULT_SETTINGS.us.package`. Verify with a migration test: the exact DDL, the seed, "Package at the old values", "Package edited before", and a second run that does nothing.
- [ ] 1.2 Read and save `us.boxes` in the shipping settings repository and normalizer, with the deploy values as defaults when the table is empty. Validate in `admin-shipping.service.js` (422 `invalid_shipping_box`), next to the other US checks, and accept `us.boxes` in `admin-shipping.validator.js`. Verify with `npx jest --runTestsByPath tests/shipping-settings.repository.test.js tests/admin-shipping.service.test.js`: "Values after deploy", "Operator records the weighed box" and "Starter not smaller than the monthly".

## 2. Box plan

- [ ] 2.1 Add `src/core/shipping-boxes.js` with `planBoxes({ packs, boxes, dryIceKg })`, returning `[{ key, label, pack_count, packs, weight_kg, weight_lb, length_in, width_in, height_in, dry_ice_kg }]`. Verify with `tests/shipping-boxes.test.js`: "Small order", "Just above the Starter", "Two pets", "Exact fit", "US monthly box of 500 g packs" (17.0 kg, 37.5 lb), "BR order" (4.0 kg, no dry ice), heaviest packs first with mixed sizes, and an empty plan without packs.
- [ ] 2.2 Add `boxes` (`key`, `label`, `pack_count`, `weight_kg`) to `presentProductionQueueItem`, from the item's line items through `cyclePacks` and `planBoxes`, with dry ice only for a US cycle. Copy `boxes` into `CourierDeliveryService.presentQueueItem` next to `lineItems`, because that item is built by hand. Verify with `npx jest --findRelatedTests src/core/production-queue-presenter.js src/services/courier-delivery.service.js`: "Production queue item" with 45 packs and "Courier delivery item" (a BR cycle with 12 packs, no dry ice).

## 3. Labels with several packages

- [ ] 3.1 `UpsClient.createShipment` accepts `packages` and sends them as an array of `Package` entries, each from `buildPackage` with its dimensions, weight and dry ice. It returns `packages: [{ trackingNumber, labelBase64 }]` in UPS order, and the first one as today's `trackingNumber`. Verify with `tests/ups-client.test.js`: two packages in the request body, both with `PackageServiceOptions.DryIce`, and two results read back.
- [ ] 3.2 In `UpsShipmentService.createForSubscription`, load the cycle's line items for the invoice, build the box plan and buy with its packages (the settings `package` when the plan is empty). Store each package's label and a row in `ups_shipment_packages`. Keep the first package in `ups_shipments`. Verify with `tests/ups-shipment.service.test.js`: "Two boxes" (one UPS call, two package rows, one active shipment) and "Cycle without sized packs".
- [ ] 3.3 The shipment presenter lists `packages`. `GET /admin/shipments/:id/label` reads `?package=N`. Void keeps one UPS call. Verify with `tests/admin-ups-shipments.routes.test.js`: "Second box label", "Package out of range" and a shipment bought before this change (no package rows) still returning its label.

## 4. Pickup weight

- [ ] 4.1 In `ups-pickup.service.js`, send the sum of the package weights of `shipment_ids`, with the settings `package` weight for a label without package rows. Change `UpsClient.createPickup` to take `totalWeightLb` and send it as `TotalWeight` without multiplying by `packageCount`, which stays the box count. Verify with the pickup tests (`npx jest --findRelatedTests src/services/ups-pickup.service.js`) and `tests/ups-client.test.js`: "Two labels with three boxes" sends `TotalWeight` 67.6 and `PackageCount` 3, not 202.8.

## 5. Docs and integration checks

- [ ] 5.1 In `docs-new/FEATURE_MEDIDAS_CAIXAS/`, record the box rule, the weight rule, where to edit the boxes, and that the checkout quote still uses the settings `package` (to be set to the monthly box until the free-shipping answer). Verify that the doc names `planBoxes`, `us.boxes` and the quote limitation.
- [ ] 5.2 Run `npx jest --changedSince=main` and verify every related test passes. Run `npm run routes:manifest` and verify `docs/api-routes.json` has no diff.
