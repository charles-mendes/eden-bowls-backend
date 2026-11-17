# Proposal

## Why

The admin user page (`/users/:id`) shows "Instruções de entrega", but the store never asks for them at purchase. The checkout address form (`eden-bowls/src/pages/checkout/Checkout.tsx`, `AddressForm`) has no such field, and `syncZipcodeToApi` always sends `delivery_instructions: ''`. Today the value can only be typed after the purchase, in the customer profile or by an operator.

Two related problems come with it:

- `POST /api/v1/onboarding/address` replaces the whole saved address. A customer who goes through checkout again loses the instructions they saved in the profile, with no warning.
- No delivery reads the instructions of the subscription. The Brazil courier queue reads only the profile copy (`delivery_instructions_source: 'profile'`), and the UPS label sends nothing. Each subscription keeps its own address, so a gift or a second address gets the instructions of the wrong place.

This change has to cover both markets. The US one adds a question: what can go to UPS with the label, and what else the label request is missing.

## What Changes

- **One rule for delivery instructions** in both markets. The text is optional. It is trimmed with inner whitespace collapsed to one line, has at most 200 Unicode characters (an emoji counts as one), and has no control characters. An invalid value is answered with 422: field `delivery_instructions` on most routes, and the existing `errors` map on the profile route. Every write path uses the rule: checkout, profile, subscription edit and both admin routes.
- **Checkout collects them.** The BR and US address steps get an optional field "Instruções de entrega" / "Delivery instructions", pre-filled from the saved address. The i18n keys already exist. The value goes in `POST /api/v1/onboarding/address` and is copied into the subscription address and the checkout snapshot, which the checkout flow already does.
- **The saved address keeps omitted instructions.** In `POST /api/v1/onboarding/address` and in the subscription edit, a request without `delivery_instructions` keeps the stored value, and `""` clears it. This works like `recipient_name`.
- **The subscription value comes first.** The courier queue and the admin screens read the subscription address instructions, fall back to the profile copy only when the profile is the same place (BR: ZIP, street and number; US: street and ZIP, normalized), and say which one they used (`subscription` or `profile`). A gift at another address without its own instructions shows none.
- **Store subscription edit.** The address step of `EditSubscription.tsx` shows and edits the subscription's instructions.
- **Admin panel.**
  - The subscription detail shows the instructions.
  - A new route `PATCH /api/v1/admin/billing/subscriptions/:id/delivery-instructions` lets an operator with `users.delivery.write` change them, with an audit event. The route goes in the route manifest.
  - The courier list labels the source.
  - The UPS label queue shows the instructions next to each order.
  - The existing profile route `PATCH /admin/users/:id/delivery-instructions` keeps its `deliveryInstructions` body and gains the rule and the audit event `users.delivery_instructions.update`.
  - The new route is audited as `billing.subscriptions.delivery_instructions.update`.
- **UPS (US).**
  - The instructions are not sent to UPS until gate 1 settles where they would go. The UPS Shipping API has no confirmed free-text field for driver instructions. The candidates (package `ReferenceNumber` printed on the label, the recipient notification memo) must be confirmed against the official schema and on CIE first. Until then, the instructions show in the label queue for whoever packs the box.
  - **Ship-to phone.** The label sends `ShipTo.Phone` from the subscription address, then from the account `billing_phone`. Today the checkout never stores a phone in the address, so UPS gets no phone.
- **Out of scope**, recorded in design: `ResidentialAddressIndicator` on the ship-to (it affects the UPS price and the checkout quote), UPS My Choice, and printing the instructions on the NF-e.

## Capabilities

### New Capabilities

- `delivery-instructions`: the delivery instructions of an address. Covers the validation rule, collection at checkout in both markets, storage in the saved and subscription addresses, the keep-when-omitted rule, customer and operator edits, the read order (subscription, then profile), and what is or is not sent to UPS.

### Modified Capabilities

- `courier-delivery`: queue rows read the subscription instructions first and report the source as `subscription` or `profile`.
- `ups-label-queue`: each order shows the delivery instructions and their source. The ship-to phone rule lives in `delivery-instructions`, next to the decision about what goes to UPS.

## Impact

- **Backend.** New code:
  - `src/core/delivery-instructions.js`, the rule.
  - The admin route and service for subscription instructions, plus `docs/api-routes.json`.

  Edited:
  - `src/services/onboarding-zipcode.service.js` and `src/infrastructure/repositories/onboarding-zipcode.repository.js`, to keep the stored value.
  - `src/services/profile.service.js`, `src/services/admin-users.service.js` and `src/api/routes/admin.routes.js`.
  - `src/api/validators/subscriptions-edit.validator.js` and `src/infrastructure/repositories/subscriptions-edit-commit.repository.js`.
  - `src/services/courier-delivery.service.js` and `src/infrastructure/repositories/profile.repository.js`.
  - `src/services/ups-shipment.service.js`, `src/infrastructure/shipping/ups-client.js` and `src/services/admin-billing.service.js`.

  No migration: the value is a key of the address JSON columns that already exist.
- **Store (`eden-bowls`).**
  - `src/pages/checkout/Checkout.tsx`, `src/pages/checkout/savedAddress.ts` (the pre-fill mapper keeps the instructions) and `src/services/onboardingApi.ts`, which stops forcing `''`.
  - `src/pages/dashboard/pages/profile/components/ProfileDeliverySection.tsx`: one line, a counter and the 200 limit.
  - `src/pages/dashboard/pages/EditSubscription.tsx` and `src/services/subscriptionEditApi.ts`.
  - `src/pages/checkout/CHECKOUT_RULES.md` and i18n (`en-us.json`, `pt-br.json`).
- **Admin panel (`eden-bowls-admin`).**
  - `src/pages/SubscriptionDetailPage.tsx`, `src/pages/LabelQueuePage.tsx`, `src/pages/CourierDeliveriesPage.tsx` and `src/lib/courierDeliveries.ts`.
  - `src/pages/UserDetailPage.tsx`, for the character limit.
  - `contracts/backend-routes.json`, via `npm run contract:sync`.
- **External.** The UPS Shipping API request changes: `ShipTo.Phone` now, and the instructions only after gate 1. Stripe is unchanged.
