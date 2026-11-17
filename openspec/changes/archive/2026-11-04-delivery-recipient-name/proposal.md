# Proposal

## Why

The checkout address has no name, so the UPS label prints the account holder's name, and a label is blocked when that name is missing or is an email. The person who receives the box is often someone else, such as a partner, a doorman or an office. The Brazil courier (change `br-courier-delivery`) needs the same information.

## What Changes

- Add a required "Nome de quem recebe" / "Recipient name" field to the delivery address in both store checkouts (US and BR), pre-filled with the account name when that is a real name.
- Store it as its own key, `recipient_name`, in the delivery address, apart from the account name. Email greetings do not change and never use it.
- Checkout refuses an address with no recipient name, with a field error, so an old saved address asks for it once.
- The recipient can be changed where the address is edited: the profile delivery address, the subscription address edit in the store, and the admin user delivery screen. Editing an address without the field keeps the stored recipient, including in the subscription edit, which today replaces the whole address.
- The UPS label prints the subscription's recipient name. Subscriptions created before this change keep today's fallback (the account name).
- The admin subscription detail and the production queue show the recipient name first, and otherwise what they show today.

## Capabilities

### New Capabilities
- `delivery-recipient`: The name of the person who receives the delivery: how it is collected, validated, stored and edited, and where it is used.

### Modified Capabilities
<!-- None: `ups-label-queue` already blocks a label with no recipient name, and that requirement does not change. -->

## Impact

- API: `POST /api/v1/onboarding/address`, `PUT|PATCH /api/v1/profile/delivery`, the admin user delivery update, the subscription edit address, the checkout validation, `UpsShipmentService.resolveRecipientName`, and the production queue presenter. No new route, so `docs/api-routes.json` does not change.
- Store: the checkout address form, the saved-address reuse, `ProfileDeliverySection`, `EditSubscription`, and pt-BR and en-US texts.
- Panel: the user delivery form, and the recipient shown in the subscription detail.
- No database migration: the address is a JSON column.
