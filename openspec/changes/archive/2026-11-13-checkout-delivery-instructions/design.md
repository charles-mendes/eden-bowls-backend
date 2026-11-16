# Design

## Context

What exists today (observed in code on 2026-11-13):

| Where | What happens to `delivery_instructions` |
|---|---|
| Store checkout `Checkout.tsx` | `AddressForm` has no field. `syncZipcodeToApi` (`onboardingApi.ts:1293`) sends `payload.deliveryInstructions \|\| ''`, so the value is always `''`. The i18n keys `checkout.fields.deliveryInstructions` and `checkout.placeholders.deliveryInstructions` exist but nothing uses them. |
| `POST /onboarding/address` → `onboarding-zipcode.repository.saveZipcode` | `ON DUPLICATE KEY UPDATE address = VALUES(address)` replaces the whole JSON. Instructions typed in the profile are lost on the next checkout. |
| Store profile `ProfileDeliverySection.tsx` → `profile.service.js:407` | `mergeAddress` patch. The field is always sent, in a 3-row textarea with no length limit. |
| Store `savedAddress.ts` `savedAddressFromDelivery` | The mapper that pre-fills the checkout from `/profile` drops `deliveryInstructions`. |
| Subscription edit pricing | An address-only edit is already `deliveryOnly` (`subscriptions-edit-commit.repository.js:139`), so it neither invoices nor moves the renewal. |
| Admin `/users/:id` → `PATCH /admin/users/:id/delivery-instructions` | Body `deliveryInstructions` (camelCase). `mergeAddress` on the profile copy, in a 4-row textarea. No audit event and no limit. |
| Subscription checkout | `context.address` is copied whole into the ledger `address` and into `checkoutSnapshot`. The admin `checkoutSnapshot.ts:377` already shows "Instruções" when present. Today it is always empty. |
| Subscription edit (`subscriptions-edit-commit.repository.js:221`) | The edit replaces the whole address. Only `recipient_name` is kept when omitted (`withStoredRecipient`). Instructions are not in the validator but pass through `.passthrough()` unvalidated. |
| Courier queue (`courier-delivery.service.js:531`) | Reads only the profile copy (`listDeliveryContacts`), with `delivery_instructions_source: 'profile'`. |
| UPS label (`ups-client.js` `buildAddress` / `createShipment`) | Sends no instructions. `ShipTo.Phone` comes from `address.phone`. The address form has no phone, and `runSubscriptionCheckout` sends `billing.phone: ''` (`Checkout.tsx:1179`), so UPS gets no phone. The account phone lives in `billing_phone`. `ShipTo` has no `ResidentialAddressIndicator`. This change adds no phone field to checkout. |

The privacy erasure works on the address JSON as a whole (`privacy.service.js`). That still has to be confirmed in task 7.2.

## Goals / Non-Goals

**Goals:**
- One rule and one storage key (`delivery_instructions`) on every write path, in both markets.
- The value a delivery uses is the one on the subscription.
- A clear answer on UPS: what can be sent now (phone) and what waits on a check against the official schema (instructions).

**Non-Goals:**
- Changing how a UPS quote is priced (residential flag, below).
- Translating or moderating the customer's text.
- Printing the instructions on the NF-e, the invoice or any email.

## Decisions

### D1. The value lives in the existing address JSON

The value is the key `delivery_instructions` of the onboarding address, the ledger subscription address and the checkout snapshot.

- *Why:* checkout already copies the address into the subscription and the snapshot. No migration is needed, and the profile, courier and snapshot readers already use this key.
- *Alternative:* a column or table of its own. Rejected: it adds a migration and a second copy that can drift from the address it describes.

### D2. A shared rule in `src/core/delivery-instructions.js`

The rule normalizes to one line, allows 200 characters and refuses control characters.

- *Why one line:* the Brazil courier list and the UPS queue show it in one cell. The UPS fields considered for later are single-line too.
- *Why 200:* it is enough for "portão, interfone, cuidado com o cachorro" and short enough to show in full on every screen.
- The store and the panel copy the limit as a constant, as `RECIPIENT_NAME_MAX_LENGTH` does today.
- *Counting:* the limit counts Unicode code points (`Array.from(text).length`) in the backend, the store and the panel. String `.length` would count an emoji as two. The HTML `maxLength` counts UTF-16 units, so it is set as a soft guard and the counter uses the code-point count.
- *Where the error goes:* the profile route reports field errors in its `errors` map (`profile.service.js:384`, `validation_error`), and the store already reads that map. The instructions use the key `deliveryInstructions` there. The other routes use `field: 'delivery_instructions'`. In the subscription edit, the rule runs after Zod, as `withRecipientName` does. Inside the schema, `wrapZod` would turn the error into `invalid_plan`.
- *Existing admin route:* `PATCH /admin/users/:id/delivery-instructions` keeps the camelCase body `deliveryInstructions` that `UserDetailPage` sends. The new subscription route uses `delivery_instructions`, like `recipient-name`.
- *Audit names* follow the existing prefixes: `users.delivery_instructions.update` (next to `users.delivery.update`) and `billing.subscriptions.delivery_instructions.update` (next to `billing.subscriptions.recipient.fill`).
- *Alternative:* multi-line with 500 characters. Rejected: it does not fit the queues, and no carrier field takes it.

### D3. An omitted field keeps the stored value

`POST /onboarding/address` and the subscription edit keep the stored value when the field is omitted, and `""` clears it. This follows the `recipient_name` pattern (`withStoredRecipient`).

- The store's `syncZipcodeToApi` stops forcing `''`. It sends the field when the form has it, which it always does after this change.
- *Why:* store versions already deployed, and any client built before this change, keep working without clearing data.
- *Alternative:* always merge the whole address. Rejected: the delivery-recipient spec defines the checkout address as a full replace, and other fields depend on that.

### D4. Subscription first, profile only for the same place, with a reported source

One helper `resolveDeliveryInstructions(subscriptionAddress, profileAddress)` returns `{ text, source }`. The courier, the UPS label queue and the admin subscription detail all use it. It uses the profile text only when `sameDeliveryPlace(a, b)` is true. That function compares the country plus ZIP, street and number in Brazil, or street line and the 5-digit ZIP in the US. Each value is normalized first: digits only for the ZIP, and the street and number lowercased, without accents and with whitespace collapsed. See spec "Deliveries read the subscription instructions first".

- *Why a fallback at all:* subscriptions created before this change have no instructions on their address. Without it, the courier would lose the profile instructions it shows today.
- *Why only for the same place:* today every checkout already stores `delivery_instructions: ''` (`onboarding-zipcode.service.js:94`). So "old subscription", "customer left it blank" and "gift with no instructions of its own" look the same in the JSON, and a key-present check cannot tell them apart. An unconditional fallback would show the buyer's home instructions on a gift, which is the bug this change fixes. Comparing the place keeps the old behavior where it is right and drops it where it is wrong.
- *Customer clearing on purpose:* the checkout address and the profile are the same onboarding JSON. Clearing the field at checkout clears the profile too, so the fallback cannot bring the text back.
- *Alternative:* a marker such as `delivery_instructions_set_at` written by checkout. Rejected: it still needs a rule for subscriptions created before the marker, and that rule would be this one.
- *Alternative:* backfill the subscriptions from the profile at deploy. Rejected: it freezes a profile text onto gift addresses, and there is no production data that needs it.
- The source tells the operator that a profile value may not describe that address.

### D5. UPS gets the phone now and the instructions after gate 1

Analysis of the UPS Shipping API (`/api/shipments/v2409/ship`):

| Candidate | Analysis | Decision |
|---|---|---|
| A ship-to "delivery instructions" field | No such field was found in the documents read. UPS lets the *recipient* set delivery preferences through UPS My Choice, not the shipper. | Not available |
| `Package.ReferenceNumber` (up to 2 per package, 35 characters, printed on the label) | Meant for shipper references (order, PO). A driver may see it on the label but is not expected to read it as an instruction. Accents print badly, so it needs plain ASCII. It costs nothing. | Candidate, needs CIE |
| `ShipmentServiceOptions.Notification` with `EMailMessage.Memo` | The memo goes in the UPS email to the recipient, not to the driver. It needs the recipient email. | Not for the driver |
| `ShipTo.Phone` | The driver can call. Today it is empty, because the checkout stores `phone: ''`. | **Do now**: subscription phone, then account `billing_phone` |
| `ShipTo.EMailAddress` | Only used for UPS notifications. It shares the customer's email with UPS. | Out of scope |
| `ShipTo.Address.ResidentialAddressIndicator` | Most deliveries go to homes. Without the flag, the rate is quoted as commercial and UPS bills the residential surcharge later. Adding it changes the checkout quote and the label cost. | Separate change |

Decision:
- Send `ShipTo.Phone` (spec "UPS receives the ship-to phone…").
- Keep the instructions off the UPS request. Show them in the label queue for whoever packs the box.
- Gate task 8.1 confirms `ReferenceNumber` against the official OpenAPI schema and on CIE, and records the result in `docs-new/FEATURE_UPS/gates-e-pontos-em-aberto.md`.
- Sending the instructions later is a small follow-up change: one field, ASCII, cut to 35 characters.
- *Why not send them now:* the field and how drivers treat it are not confirmed. Text cut to 35 characters or with garbled accents could mislead a driver. The user's memory note says the AI has no QA access, so a person has to run the CIE check.

### D6. Brazil courier

No external call. The courier list shows the text and its source (D4). The NF-e (Bling) stays as it is (Non-Goals).

### D7. Admin route for subscription instructions

`PATCH /api/v1/admin/billing/subscriptions/:id/delivery-instructions` follows the shape of `.../recipient-name`: same permission, market scope, 404 for unknown or out of market, and an audit without the text.

- Unlike `recipient-name`, it replaces and clears, because instructions change more often and do not block a dispatch.
- New route: `npm run routes:manifest` in the backend, and `npm run contract:sync` in the panel.

## Risks / Trade-offs

- [Customers expect the driver to read the instructions in the US] → Show them in the label queue so the operator can act, for example by writing on the box. State the limit in the store field's helper text for US addresses: "Our team reads these; UPS drivers may not see them". This copy is decided in task 4.1.
- [The same-place check misses a small spelling difference, such as "R." against "Rua"] → The delivery shows no instructions, the safe side. The operator can fill the subscription through the new admin route. Expanding abbreviations is not done.
- [A profile text at the same place is still live] → A later profile edit changes what old subscriptions at that place show. The source `profile` is shown, and the courier list keeps the "(do perfil)" mark.
- [The phone goes to UPS without being asked for] → The phone is used only for delivery, which the legal documents already cover for the courier. Task 7.2 also checks that the privacy text covers sharing with carriers.
- [Old store build sends `''` on every checkout save] → Within that window the value is cleared exactly as today. The new build sends the real value. There is no production yet (user memory), so the window does not matter.

## Migration Plan

- No database migration.
- Order of deploy: backend first, which accepts and keeps the field. Then the store and the panel.
- Rollback: revert the store field. The backend's keep-when-omitted rule is safe with any client.
