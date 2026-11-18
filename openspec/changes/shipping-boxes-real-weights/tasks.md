# Tasks

Sibling change: `shipping-boxes-real-weights` in `eden-bowls-admin`. Deploy the API first. Independent of the Starter and shipping-price changes.

## 1. Weights

- [ ] 1.1 Add migration `1700000000088-shipping-boxes-real-weights.js`: `ALTER` `shipping_us_boxes.empty_weight_kg` to DECIMAL(6,3) NOT NULL, then set the `starter` row to 0.355 where it is 1.00 and the `monthly` row to 0.600 where it is 1.50. `down` restores 1.00 and 1.50 only where the values are still 0.355 and 0.600, then DECIMAL(5,2). Register it in `src/infrastructure/db.js`, and set the same values in `DEFAULT_SETTINGS.us.boxes`. Verify with a migration test: "Values after deploy", "Weight changed before the deploy", and a second run that does nothing.
- [ ] 1.2 Check that the repository and normalizer keep three decimals on read and save. Verify with `npx jest --runTestsByPath tests/shipping-settings.repository.test.js tests/admin-shipping.service.test.js`: "Operator records the weighed box" with 0.615.

## 2. Box plan

- [ ] 2.1 Update the comment of `planBoxes` in `src/core/shipping-boxes.js` to state the economical rule (fewest boxes, then smallest), and the expectations of `tests/shipping-boxes.test.js`. Verify with `npx jest --runTestsByPath tests/shipping-boxes.test.js tests/production-queue-presenter.test.js`: "Just above the Starter" (one monthly, not two Starters), "US monthly box of 500 g packs" (16.1 kg, 35.5 lb), "US Starter box of 500 g packs" (5.855 kg, 13.0 lb) and "BR order" (3.355 kg).

## 3. Docs and integration checks

- [ ] 3.1 Update `docs-new/FEATURE_MEDIDAS_CAIXAS/caixas-de-envio.md`: table with 355 g and 600 g, the economical rule and the new weight examples. Verify the doc no longer says 1,0 kg or 1,5 kg.
- [ ] 3.2 Run `npx jest --changedSince=main` and verify every related test passes.
