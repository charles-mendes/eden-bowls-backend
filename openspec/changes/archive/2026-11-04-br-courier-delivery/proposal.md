# Proposal

## Why

Brazil delivers by courier (Uber, motoboy or our own driver), but the system only knows UPS. The panel simply hides the UPS section for Brazil, so nothing records that a box left, who took it, or that it arrived, and the customer sees no delivery progress and gets no delivery email.

## What Changes

- Add a courier delivery record for each paid Brazil delivery cycle. An operator registers it by hand when the box leaves: the method (Uber, motoboy, own driver, other), the courier name, an optional tracking link, the cost and a note. No courier API is called.
- The record moves through out for delivery, then delivered or failed. A failed attempt can be dispatched again. A record created by mistake can be canceled before it is delivered.
- Add an admin "Entregas Brasil" queue: paid BR cycles waiting to leave, deliveries on the road, failed attempts, and recent deliveries. Each row shows the recipient, neighborhood, city, delivery date and production status.
- Show the courier section in the subscription detail page of a Brazil subscription, where the UPS section is hidden today.
- The store plan history shows a three-stage timeline for a Brazil delivery: in preparation, out for delivery, delivered. A failed attempt shows as a warning on the current stage. A tracking link is shown when the operator gave one.
- Send the customer two new letters: out for delivery and delivered.
- New `/api/v1/admin/...` routes for the queue and the record actions. They update `docs/api-routes.json` and the panel contract.

## Capabilities

### New Capabilities
- `courier-delivery`: Records, by hand, the courier delivery of a paid Brazil cycle, the admin queue and actions for it, and the delivery timeline the store shows for it.

### Modified Capabilities
- `transactional-emails`: Adds the out-for-delivery and delivered letters for courier deliveries.

## Impact

- API: new table and migration, a repository, a service, admin routes with `shipping.read` and `shipping.write` permissions and market scope, an audit entry for each action, the customer subscription detail (billing history timeline), and the mailer (two templates).
- Panel (`eden-bowls-admin`): a new "Entregas Brasil" page, a courier section in `SubscriptionDetailPage`, and `contracts/backend-routes.json`.
- Store (`eden-bowls`): the plan history timeline for courier stages, and pt-BR and en-US texts.
- No change to UPS, the UPS queue, Stripe, or Bling.
