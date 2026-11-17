# Design

## Context

See proposal.md for why. Today `UpsClient.buildPackage` (`src/infrastructure/shipping/ups-client.js:253`) builds only packaging, dimensions and weight. `rate` (line 269) and `createShipment` (line 365) both start from it. The three callers all pass the stored `settings.package` / `us.package`:

- `shipping.service.js:148`: the checkout quote, when `quote_mode=ups`.
- `admin-shipping.service.js:266`: the admin simulation, Shoptimeintransit first and then Shop.
- `ups-shipment.service.js:346`: label purchase.

The US package lives in `shipping_us_settings` (`package_weight_lb`, `package_length_in`, …). It is read by `usFromRow` and written by `usToParams` in `src/infrastructure/shipping/shipping-settings.js`. That write uses positional parameters that line up with the column list in `shipping-settings.repository.js`, whose last entry today is `ship_from_phone`. `max_transit_days` (migration `1700000000047`) is a recent US field added the same way.

The checkout quote only receives the customer ZIP code. `calculateUs` reads `zipCode` from the payload and sends UPS `city: 'City'` and `state: 'NY'`. The admin simulation and the label send the real city and state. Its range check sits in `admin-shipping.service.js` and returns 422 `invalid_max_transit_days`.

UPS publishes the dry ice option in its official OpenAPI specs (`UPS-API/api-documentation`, `Shipping.yaml` and `Rating.yaml`) as `Package.PackageServiceOptions.DryIce`:

- `RegulationSet` is required: `CFR` for US domestic or ground to Canada, `IATA` for air, `ADR` for EU ground.
- `DryIceWeight.UnitOfMeasurement.Code` is required: `00` = KG, `01` = LB. Rating also requires `Description`.
- `DryIceWeight.Weight` is required. It is a string greater than 0.0, with at most one decimal place and at most 5 characters. It cannot exceed the package weight.
- `MedicalUseIndicator` and, in Rating, `AuditRequired` are presence flags.
- UPS runs a lane check by postal code and city.

## Goals / Non-Goals

**Goals:**
- One place builds the dry ice block, so the label and the quotes cannot drift apart.
- The callers do not change.

**Non-Goals:**
- Reading the dry ice surcharge back out of the UPS response, or storing it on `ups_shipments`. The quoted total already includes it.
- A per-order or per-pack dry ice weight. The specification is 500 g per box, whatever the box size.
- An on/off switch. Every US box ships with dry ice, so the declaration is always sent.

## Decisions

1. **Store the weight inside `package` as `dry_ice_kg`, column `package_dry_ice_kg DECIMAL(3,1) NOT NULL DEFAULT 0.5`.** Every caller already passes `package` to `rate` and `createShipment`, so no service signature changes. The other option was a top-level `us.dry_ice_kg` passed as a new argument. That would touch all three callers, and one forgotten caller would send an undeclared quote. `DECIMAL(3,1)` matches the UPS one-decimal rule. Kilograms match the specification (500 g) and UPS code `00`.

2. **`buildPackage` adds `PackageServiceOptions.DryIce` whenever `dry_ice_kg` is a positive number.** The block has `RegulationSet: 'CFR'` and `DryIceWeight: { UnitOfMeasurement: { Code: '00', Description: 'Kilograms' }, Weight: dryIceKg.toFixed(1) }`. Rating requires `Description` and Shipping accepts it, so one shape serves both. `createShipment` already spreads `buildPackage` and only renames `PackagingType`, so the block reaches the label unchanged. The `ShipmentTotalWeight` that `rate` sends for transit is still the package weight. `MedicalUseIndicator` and `AuditRequired` are left out: the product is food, and UPS says domestic non-hazardous goods packed with dry ice need no Dangerous Goods agreement.

3. **The range is 0.1 to 2.5 kg, with one decimal place, and no heavier than the package.** The check is in `admin-shipping.service.js` next to the transit days check. The merged package is converted at 1 lb = 0.45359237 kg. A violation returns 422 `invalid_dry_ice_kg`. Zero is refused rather than meaning "off", because sending a box without the declaration is what this change closes. 2.5 kg is the per-package limit above which UPS asks for a Dangerous Goods agreement and shipping papers on domestic air. Going above it is a decision for the client, not for an operator typing in the admin. The package check exists because UPS refuses a dry ice weight above the package weight. Catching that when the settings are saved beats a refused label later.

4. **The validator only types the field (`optionalNumber`), as with the other package fields.** The service owns the rule and its message, which keeps the 422 shape of `invalid_max_transit_days`.

## Risks / Trade-offs

- [UPS lane check refuses dry ice on a ZIP code] → The label fails the way any refused label does today. The pending row is removed and the operator sees the UPS code. The quote fails over to the fallback, if that is enabled. The weekly CIE test covers a few destinations before go-live.
- [CIE returns fictitious rates, so the US$ 8.55 surcharge cannot be confirmed in QA] → Gate 8 already covers this. The controlled production test compares the quote with the UPS invoice.
- [The UPS dry ice lane check, by postal code and city, refuses the checkout quote because the city is the placeholder `City` / `NY`] → Task 3.1 runs a checkout-shaped quote on CIE (real ZIP, placeholder city). If UPS refuses it, "the callers do not change" no longer holds. Checkout would need the real city and state, and that changes the payload of the quote route and the store. In that case, stop and revise this change before going further. Do not silently drop the declaration from the quote.
- [The package weight is in pounds and the dry ice in kilograms] → For every value the admin accepts, the number in kilograms is smaller than the number in pounds. The UPS check "cannot be more than package weight" passes whether UPS converts the units or compares the raw numbers. The official examples use the same unit for both, so task 3.1 confirms the mix on CIE.
- [Positional parameters in `usToParams` get out of order with the repository column list] → Add `package_dry_ice_kg` after `ship_from_phone`, at the end of both lists. `tests/shipping-settings.repository.test.js` checks the order.
- [Existing tests compare the whole package body] → Update those fixtures to include the dry ice block rather than loosening the assertion.
- [A UPS invoice adds the surcharge to labels bought before the quote was updated] → It does not matter: QA only, and production is not live.

## Migration Plan

1. Migration `1700000000069-add-us-dry-ice-kg.js` adds `package_dry_ice_kg DECIMAL(3,1) NOT NULL DEFAULT 0.5` when the table exists and the column does not. Its `down` drops the column. Register it in `src/infrastructure/db.js`.
2. Deploy the API. The existing row takes 0.5, so the next quote and label carry the declaration with no operator action.
3. Rollback: revert the build, then run the migration's `down`. Labels bought in between stay declared at UPS.
