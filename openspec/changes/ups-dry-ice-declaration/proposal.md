# Proposal

## Why

Each Eden Bowls box sent to the United States carries 500 g of dry ice as a refrigerant. On 2026-11-09 UPS confirmed by phone that Ground (`03`) accepts it, that the account needs no Dangerous Goods agreement, and that the dry ice must be declared on the shipment as Dry Ice / Carbon Dioxide, Solid — UN1845, through an approved system such as the API. Today neither the label nor the quote sent to UPS says anything about dry ice. This is gate 1 in `docs-new/FEATURE_UPS/gates-e-pontos-em-aberto.md`, and it blocks `quote_mode=ups` in production.

## What Changes

- The US shipping settings hold `package.dry_ice_kg`, the dry ice weight in each box, in kilograms, set to 0.5 on deploy. `GET /api/v1/admin/shipping/settings` returns it and `PUT` accepts it. A value that is not from 0.1 to 2.5 with one decimal place, or that is heavier than the package weight, is refused with 422.
- Every UPS label request declares the dry ice on the package: `PackageServiceOptions.DryIce` with `RegulationSet: CFR` and the stored weight in kilograms.
- Every UPS rate request (checkout quote and the admin simulation) sends the same declaration. If UPS charges a dry ice surcharge on Ground (US$ 8.55 per package in the 2026 Rate & Service Guide), the quote already includes it.
- No new route. No change to `allowed_service_codes`. Ground stays the service.
- Out of scope: physical box marking (warehouse work), the `MedicalUseIndicator` (the product is not medical), and the `quote_mode=ups` switch itself. The remaining items of the production checklist stay where they are.

## Capabilities

### New Capabilities

- `ups-dry-ice`: how the API declares dry ice to UPS on labels and quotes for US shipments.

### Modified Capabilities

- `shipping-settings`: adds the editable US dry ice weight per box.

## Impact

- New migration `1700000000069` adds `package_dry_ice_kg` to `shipping_us_settings`, registered in `src/infrastructure/db.js`.
- Edited: `src/infrastructure/entities/shipping-settings.entity.js`, `src/infrastructure/repositories/shipping-settings.repository.js`, `src/infrastructure/shipping/shipping-settings.js`, `src/api/validators/admin-shipping.validator.js`, `src/services/admin-shipping.service.js`, `src/infrastructure/shipping/ups-client.js`.
- Callers of `rate` and `createShipment` already pass `settings.package`, so `shipping.service.js`, `admin-shipping.service.js` and `ups-shipment.service.js` keep their calls. One condition: the checkout quote sends only the real ZIP, with the placeholder city `City` / `NY`. If the UPS dry ice lane check refuses that on CIE, checkout needs the real city and state, and this change is revised before it is applied.
- The admin panel (`eden-bowls-admin`) needs a field for the dry ice weight on the US shipping settings page, in its own change.
- Docs: gate 1 and the production checklist in `docs-new/FEATURE_UPS/gates-e-pontos-em-aberto.md`.
- `docs/api-routes.json` does not change.
