# Tasks

## 1. Dry ice weight setting

- [x] 1.1 Add migration `1700000000069-add-us-dry-ice-kg.js`. It adds `package_dry_ice_kg DECIMAL(3,1) NOT NULL DEFAULT 0.5` to `shipping_us_settings` only when the table exists and the column does not, and its `down` drops the column. Register it in `src/infrastructure/db.js`. Verify with `npx jest --runTestsByPath tests/shipping-settings.migration.test.js`: a new test checks the exact `ALTER TABLE` text, that a second run does nothing, and the `DROP COLUMN` text.
- [x] 1.2 Add `packageDryIceKg` to `src/infrastructure/entities/shipping-settings.entity.js` and add `package_dry_ice_kg` at the end of the column list in `src/infrastructure/repositories/shipping-settings.repository.js`. In `src/infrastructure/shipping/shipping-settings.js`:
  - Set `DEFAULT_SETTINGS.us.package.dry_ice_kg` to 0.5.
  - Carry `dry_ice_kg` through `mergePackage` and `usFromRow`.
  - Append it last in `usToParams`, after `ship_from_phone`, so the position matches the column list.

  Verify with `npx jest --runTestsByPath tests/shipping-settings.test.js tests/shipping-settings.repository.test.js`: a saved 1.2 reads back as 1.2, and a row without the column reads 0.5.
- [x] 1.3 Add `dry_ice_kg: optionalNumber` to the `package` object in `src/api/validators/admin-shipping.validator.js`. In `src/services/admin-shipping.service.js`, next to the transit days check, refuse the merged settings with 422 `invalid_dry_ice_kg` when `dry_ice_kg` is below 0.1, above 2.5, has more than one decimal place, or weighs more than `weight_lb × 0.45359237`. Verify with `npx jest --runTestsByPath tests/admin-shipping.service.test.js`: the spec scenarios "Above the limit", "Zero is refused", "Two decimal places" and "Heavier than the package" return 422 and leave the stored settings unchanged, and a saved 1.2 is returned by `GET`.

## 2. Dry ice declaration to UPS

- [x] 2.1 In `UpsClient.buildPackage` (`src/infrastructure/shipping/ups-client.js`), add `PackageServiceOptions.DryIce` when `pkg.dry_ice_kg` is positive. The block is `{ RegulationSet: 'CFR', DryIceWeight: { UnitOfMeasurement: { Code: '00', Description: 'Kilograms' }, Weight: Number(pkg.dry_ice_kg).toFixed(1) } }`, with no `MedicalUseIndicator` and no `AuditRequired`. Keep `createShipment` renaming only `PackagingType`. Verify with `npx jest --runTestsByPath tests/ups-client.test.js`:
  - A label request with `dry_ice_kg` 0.5 sends `Weight: '0.5'` under `CFR` on `ShipmentRequest.Shipment.Package` with service `03`.
  - A Shop and a Shoptimeintransit rate request carry the same block.
  - Existing tests that compare the whole package body are updated to include the block.
- [x] 2.2 Confirm that the three callers pass the stored package unchanged, with no edits to their calls: `shipping.service.js` (checkout quote), `admin-shipping.service.js` (simulation) and `ups-shipment.service.js` (label). Verify with `npx jest --runTestsByPath tests/ups-shipping.test.js tests/ups-shipment.service.test.js tests/admin-shipping.service.test.js`: a new assertion in each test file checks that the request handed to the UPS client includes `package.dry_ice_kg` from the settings. In `tests/ups-shipping.test.js` (checkout), the test "uses UPS rate when quote_mode is ups" today only checks that `rate` was called. It gains a check on the `package` argument.
- [x] 2.3 Update gate 1 in `docs-new/FEATURE_UPS/gates-e-pontos-em-aberto.md`:
  - State that the label and the quotes declare dry ice from the `package.dry_ice_kg` setting (0.5 kg, editable from 0.1 to 2.5 in the admin).
  - Tick "Confirmação dry ice / serviço permitido" in the production checklist only after task 3.1 passes.

  Verify the gate text names `CFR`, UN1845 and `dry_ice_kg`.

## 3. Integration checks

- [ ] 3.1 On QA (CIE), exercise the three UPS requests with the dry ice declaration:
  - the US shipping simulation from the admin;
  - a checkout-shaped quote: `quote_mode=ups`, real customer ZIP, and the placeholder `city: 'City'` / `state: 'NY'` that `calculateUs` sends;
  - one label for a test invoice.

  Verify that both quotes return a rate with no UPS error, and that the label is stored with a tracking number. This also confirms that UPS accepts a package weight in pounds with the dry ice in kilograms. If UPS refuses the declaration on any of them, record the UPS code in gate 1 and stop before ticking the checklist. If only the checkout quote is refused because of the placeholder city, revise this change (design decision 1 and the quote route payload) before going further.
- [x] 3.2 Run `npx jest --changedSince=main` and verify every related test passes. Run `npm run routes:manifest` and verify `docs/api-routes.json` has no diff.
- [x] 3.3 Open the sibling change in `eden-bowls-admin` for the "Gelo seco por caixa (kg)" field on the US shipping settings page, which sends `package.dry_ice_kg` and shows the 422 message. Verify that change exists and names this backend change as its dependency.
