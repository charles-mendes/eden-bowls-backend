# Tasks

## 1. Validation rule (backend)

- [x] 1.1 Create `src/core/delivery-instructions.js` with:
  - `DELIVERY_INSTRUCTIONS_MAX_LENGTH = 200`.
  - `parseDeliveryInstructionsInput(value)`. It returns `undefined` when the field is omitted and `''` for blank. For any other value it returns the text trimmed and collapsed to one line, and it throws 422 with field `delivery_instructions` when the text is longer than 200 code points (`Array.from(text).length`), has a control character, or is not a string.
  - `sameDeliveryPlace(a, b)`, with the normalization of D4: country; ZIP digits (5 in the US); BR street and number; US street line.
  - `resolveDeliveryInstructions(subscriptionAddress, profileAddress)`, which returns `{ text, source }` and uses the profile only when `sameDeliveryPlace` is true.

  Verify with `npx jest --runTestsByPath tests/delivery-instructions.test.js` (new). It covers:
  - the scenarios "Normal text", "Too long", "Only spaces" and "Emoji counts as one character", and a control character;
  - the read-order scenarios "Subscription has its own", "Old subscription at the profile address", "Gift at another address without instructions" and "US street with a different ZIP+4";
  - a BR address with the same ZIP and street but another number, which counts as another place.

## 2. Checkout address keeps and validates instructions (backend)

- [x] 2.1 In `src/services/onboarding-zipcode.service.js`, parse `delivery_instructions` with the rule. When it is `undefined`, read the stored address and keep its value. In `onboarding-zipcode.repository.js`, keep the full replace of the JSON. Verify with `npx jest --runTestsByPath tests/onboarding-zipcode.service.test.js tests/onboarding-zipcode.routes.test.js`: the scenarios "Older client without the field" and "Customer clears the field" pass, a 201-character value gets 422 and nothing is saved, and the existing `recipient_name` tests still pass.
- [x] 2.2 Confirm that subscription checkout copies the value into the ledger address and the checkout snapshot. No code change is expected. Verify with a new assertion in `tests/onboarding-subscription-checkout.service.test.js` that `ledgerRepository.upsert` receives `address.delivery_instructions` and `checkoutSnapshot.address.delivery_instructions`.

## 3. Profile and admin profile routes (backend)

- [x] 3.1 In `src/services/profile.service.js`, apply the rule to `deliveryInstructions`. Report an invalid value as `errors.deliveryInstructions` in the existing `validation_error` 422, next to the other field errors. An omitted field keeps the stored value instead of clearing it. Verify with `npx jest --runTestsByPath tests/profile.service.test.js`: the scenario "Too long on the profile" passes, and an omitted field keeps the value.
- [x] 3.2 In `admin-users.service.updateDeliveryInstructions`, keep reading the body key `deliveryInstructions` in `admin.routes.js`. Apply the rule, with 422 field `delivery_instructions`, and write the audit event `users.delivery_instructions.update` with the actor and the customer, without the text. Verify with `npx jest --runTestsByPath tests/admin-users-delivery.service.test.js`: the scenario "Profile instructions saved by an operator" passes, the audit metadata has no text, and an invalid value gets 422.
- [ ] 3.3 In the store, `ProfileDeliverySection.tsx` keeps the field as one line: an input, or a textarea that turns line breaks into spaces. Add a counter with the code-point count, block saving above 200, and show `errors.deliveryInstructions` from the API under the field. Verify with `npx vitest run src/pages/dashboard/pages/profile/components/ProfileDeliverySection.test.tsx`: the counter counts an emoji as one, saving is blocked at 201, and the API error shows under the field. Attach a Playwright capture.

## 4. Store checkout field (eden-bowls)

- [ ] 4.1 In `src/pages/checkout/savedAddress.ts`:
  - `savedAddressFromDelivery` copies `deliveryInstructions` into the `SavedAddress` it returns.
  - `SavedAddress` gains the field.

  In `src/pages/checkout/Checkout.tsx`:
  - Add `deliveryInstructions` to `AddressForm` and `EMPTY_ADDRESS`, and pre-fill it from that mapper.
  - Keep `AddressErrors` excluding the field, as it is optional.
  - Render an optional one-line input with the existing `checkout.fields.deliveryInstructions` and `checkout.placeholders.deliveryInstructions` keys, for BR and US, with a code-point counter that blocks at 200. For US, add a helper text: "Our team reads these; UPS drivers may not see them" (EN) and "Lemos estas instruções; o motorista da UPS pode não vê-las" (PT). The new keys go in both i18n files. Verify with `npx vitest run src/pages/checkout`:
  - `savedAddress.test.ts` asserts that the mapper keeps `deliveryInstructions`.
  - New tests check that the field is pre-filled, sent and optional in both markets.
- [ ] 4.2 In `src/services/onboardingApi.ts`, `syncZipcodeToApi` sends `delivery_instructions` only when `payload.deliveryInstructions !== undefined`, without the `|| ''`. Update `CHECKOUT_RULES.md` with the field, the limit and the keep-when-omitted rule. Verify with the existing `onboardingApi` tests plus one that asserts the body omits the key when it is undefined.
- [ ] 4.3 Capture the BR and US address steps with Playwright, the field empty and filled, before delivery. Verify by attaching the screenshots.

## 5. Subscription edit (backend and store)

- [ ] 5.1 Validator and commit for the subscription edit:
  - In `src/api/validators/subscriptions-edit.validator.js`, add `delivery_instructions: z.string().optional()` to `editAddressSchema`.
  - Apply the rule after Zod, in a `withDeliveryInstructions` step chained next to `withRecipientName` and outside `wrapZod`, so the 422 keeps field `delivery_instructions`.
  - In `subscriptions-edit-commit.repository.js`, extend `withStoredRecipient` (or add a sibling helper) so an omitted `delivery_instructions` is copied from the stored address.
  - Pricing needs no new rule: an address-only edit is already `deliveryOnly` (line 139).

  Verify with `npx jest --runTestsByPath tests/subscriptions-edit.validator.test.js tests/subscriptions-edit-commit.repository.test.js tests/subscriptions-edit-commit.service.test.js`:
  - The scenarios "Too long on the subscription edit", "Street change without the field" and "Instructions change only" pass.
  - The last of these asserts `prorationBehavior: 'none'` and no invoice.
- [ ] 5.2 In the store, `EditSubscription.tsx` and `subscriptionEditApi.ts` show and send the subscription's `delivery_instructions` in the address step, with the same limit and counter. Verify with `npx vitest run src/pages/dashboard/pages/EditSubscription` and a Playwright capture of the step.

## 6. Admin subscription instructions route (backend)

- [ ] 6.1 Add `PATCH /api/v1/admin/billing/subscriptions/:id/delivery-instructions` in `admin.routes.js`, with `requirePermission('users.delivery.write', { market: 'record' })`, and an `admin-billing.service` method modeled on the recipient-name one: body `delivery_instructions`, replace or clear, audit `billing.subscriptions.delivery_instructions.update` without the text, 404 for unknown or out of market. Verify with `npx jest --runTestsByPath tests/admin-billing.delivery-instructions.test.js` (new), which covers the scenarios "Operator fixes the gate", "Other market" and "Missing permission".
- [ ] 6.2 Return `delivery_instructions` and `delivery_instructions_source` (using `resolveDeliveryInstructions`) in the admin subscription detail answer. Verify with a new assertion in `tests/admin-billing.recipient-name.test.js` or in the subscription detail service test.
- [ ] 6.3 Run `npm run routes:manifest` and commit `docs/api-routes.json`. Verify with `npx jest --runTestsByPath tests/api-routes-manifest.test.js`.

## 7. Courier and privacy (backend)

- [ ] 7.1 Courier rows:
  - `profile.repository.listDeliveryContacts` also returns the profile address fields that `sameDeliveryPlace` needs: country, ZIP, street and number.
  - `courier-delivery.service.js` calls `resolveDeliveryInstructions(subscriptionAddress, profileAddress)` and sets `delivery_instructions_source` to `subscription`, `profile` or `null`.

  Verify with `npx jest --runTestsByPath tests/courier-fields.test.js tests/courier-delivery.service.test.js tests/profile.repository.delivery-contacts.test.js`: the scenarios "Complete row", "Instructions only in the profile, same place", "Gift at another place" and "No instructions" from the courier-delivery delta pass.
- [ ] 7.2 Confirm that the privacy export includes the instructions with each address, and that erasure clears the profile and subscription addresses with them. If erasure keeps the address JSON, clear `delivery_instructions` explicitly. Verify with `npx jest --runTestsByPath tests/privacy.service.test.js tests/privacy.repository.test.js`: the scenario "Erasure" passes.

## 8. UPS (backend)

- [ ] 8.1 Gate. Check the official UPS Shipping API OpenAPI schema (developer.ups.com, Shipping v2409) for:
  - Any ship-to or shipment field for delivery instructions.
  - The `Package.ReferenceNumber` limits and whether it prints on a Ground label.
  - Whether `ShipTo.Phone` is required for Ground.

  Record the result in `docs-new/FEATURE_UPS/gates-e-pontos-em-aberto.md`, with a CIE test that the user runs by hand (the AI has no QA access). If a field is confirmed, open a follow-up change to send the instructions. This change still sends none. Verify by the updated document.
- [ ] 8.2 In `ups-shipment.service.inspectLabel`, set `shipTo.phone` from the subscription address, then from the account `billing_phone` (via the profile repository). `ups-client.buildAddress` already strips the number to 15 digits. Do not change `rate`. Verify with `npx jest --runTestsByPath tests/ups-shipment.service.test.js tests/ups-client.test.js`:
  - The scenario "Phone from the account" passes.
  - With no phone, `Phone` stays undefined.
  - A subscription address holding instructions produces a `ShipmentRequest` with no copy of that text (scenario "Instructions are not sent").
- [ ] 8.3 Add `delivery_instructions` and `delivery_instructions_source` to each order of the label queue answer. Verify with `npx jest --runTestsByPath tests/ups-label-queue.test.js tests/admin-ups-shipments.routes.test.js`: the scenario "Order with instructions" passes.

## 9. Admin panel (eden-bowls-admin)

- [ ] 9.1 In `SubscriptionDetailPage.tsx`, show the instructions with their source and a small form that calls the new route, shown only with `users.delivery.write`. Run `npm run contract:sync` and commit `contracts/backend-routes.json`. Add the route to `src/test/mockAdminFetch.ts`. Verify with `npx vitest run src/pages/SubscriptionDetailPage.test.tsx` and a Playwright capture.
- [ ] 9.2 `CourierDeliveriesPage.tsx` and `lib/courierDeliveries.ts` accept the `subscription` source and label it "Instruções" or "Instruções (do perfil)". `LabelQueuePage.tsx` shows the instructions on each order. Verify with `npx vitest run src/pages/CourierDeliveriesPage.test.tsx src/pages/LabelQueuePage.test.tsx` and Playwright captures. Check that global table CSS does not break the cell (user memory).
- [ ] 9.3 In `UserDetailPage.tsx`:
  - Keep sending `deliveryInstructions`.
  - Make "Instruções de entrega" one line, using a code-point counter that blocks at 200.
  - Show the API 422 message. Verify with `npx vitest run src/pages/UserDetailPage.test.tsx`.

## 10. Integration check

- [ ] 10.1 Run `npx jest --changedSince=main` in the backend and `npx vitest run --changed main` in the store and the panel. Then walk through it by hand on localhost:
  - A BR checkout with instructions shows them in the courier list with source `subscription`.
  - A US checkout shows them in the label queue, and the UPS request carries the phone and not the text.
  - A second checkout without changing the field keeps the profile value.
  - A gift subscription at another address, with no instructions, shows none in the courier list, while the profile holds instructions.

  Verify by green runs and the notes of the walkthrough.
