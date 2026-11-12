# Proposal

## Why

An address problem only closes when the customer saves data that passes, an operator fills the recipient, or a new event supersedes it. A subscription that ends with no box left to ship keeps its problem open forever. Today counts it in "N problemas de endereço abertos · M sem correção há mais de 2 dias", and the filtered Entregas Brasil list it opens is empty, because no row is left to show. In QA, problem 1 of subscription 179 stays open after the subscription was canceled and its only paid cycle was delivered.

## What Changes

- An open address problem closes with `resolved_by: ended` when its subscription has ended (status `canceled` on the ledger, which also stores Stripe's `incomplete_expired`) and has no paid cycle whose box has not left. A paid cycle is one with `paid_at` and `paid_invoice_id`. A cycle not paid yet does not keep the problem open. A box has left when the cycle's invoice has a courier delivery on the road or delivered, or a UPS label created or delivered. A failed courier delivery does not count as left.
- The rule is checked when Stripe reports the subscription changed (cancellation included), when a courier delivery goes out, and when a UPS label is created, so it applies whichever comes last: the end or the last box leaving.
- A canceled subscription with a paid box still to leave keeps its problem open. The box still needs the address, and the customer was told to fix it.
- Closing as `ended` sends no email and opens nothing.
- At deploy, the open problems that already meet the rule close the same way. This closes problem 1 of subscription 179.
- `ended` fits `resolved_by VARCHAR(16)`, so the column stays as it is.
- Today's count rule does not change. It still counts every open problem of the market and may still differ from the filtered queue (`operations/today-overview`).
- Panel: "Operador corrigiu em dd/mm" for `operator` and "Assinatura encerrada em dd/mm" for `ended`. Today, every resolved state other than `customer` reads "Substituído em dd/mm", which is wrong for `operator`. This is specified and tracked by the panel's change with the same name (`eden-bowls-admin/openspec/changes/close-address-issues-when-subscription-ends`).

## Capabilities

### New Capabilities

_None._

### Modified Capabilities

- `delivery-address-issues`: adds the closing on subscription end and the closing of existing problems at deploy.

## Impact

- Backend: the address problem repository (one query for the rule, for a single subscription and for all), the address problem service, the Stripe webhook subscription handler, the courier dispatch and the UPS label creation. A migration closes the problems already open. Tests cover the repository, the service and the migration.
- API: `address_issue.resolved_by` can now be `ended`. No route is added, renamed or removed, so the routes manifest does not change.
- Panel (`eden-bowls-admin`): its paired change adds the `operator` and `ended` texts. Both changes are applied and archived together.
- Out of scope: the recipient name of subscription 179 disappearing from its address after the dispatch, and whether a click on Today's count should list every counted problem.
