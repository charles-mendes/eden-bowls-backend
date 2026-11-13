# Proposal

## Why

The admin subscription detail (`/billing/subscriptions/:id`) is organized by data source (Stripe, Bling, courier, checkout), not by the work the operator has to do. A review of subscription 2717 found that the page never says how this month's order stands or what to do next, that a refused NF-e shows only Bling's generic message, that delivery actions are hidden on a phone, and that one Stripe invoice appears in three sections under three names. The same review found two Eden Bowls invoices (`EB-2026-000010` as `br`, `EB-2026-000011` as `us`) for one Stripe invoice. Locally both webhook endpoints share one Stripe sandbox, so the same `invoice.paid` reached both and each issued a PDF. Nothing in the API checks that the delivering endpoint is the subscription's account, so a Brazil customer can get a second invoice in English with the United States issuer.

## What Changes

- **API, webhook**: `invoice.paid` for a subscription already stored with an account is handled only when it arrives on that account's endpoint. On the other endpoint it returns 200 and writes nothing, like the existing `eden_env` marker guard. That means no new contract, ledger, checkout reference, NF-e row, production cycle, delivery counter, invoice PDF, letter or Stripe write. It logs `account_mismatch` with the subscription, the invoice and both accounts.
- **API, NF-e**: `GET /api/v1/admin/billing/subscriptions/:id/nfe` items also carry `stripe_invoice_id`, `missing_fields` and `bling_problems`, which the note detail already returns, so the subscription page can say what to fix without opening the note.
- **Panel, subscription detail**:
  - A header in place of the four metric cards: the account name (or the email) as the title, then the status, the renewal or end day without the time, and the pause and cancel note.
  - A "Ciclo atual" card: the oldest paid cycle not yet delivered (else the newest delivered). It shows its stage, its dates and the one next action. The stage covers production (to prepare, in preparation, ready, blocked), courier (out for delivery, delivered, failed) and UPS (from the shipment's status and tracking).
  - A "Precisa de atenção" block that lists, each with its next step:
    - a refused, failed or blocked NF-e, linking to the note;
    - an open address problem, linking to its section, which keeps the contact action;
    - a delivery lock;
    - a failed delivery;
    - the account/country mismatch, which replaces the standalone warning.
  - One "Cobranças" section (anchor `#faturas-stripe`), with one row per Stripe invoice, putting the paid cycle, the Eden Bowls invoice, the NF-e and "PDF Stripe" side by side.
    - It is built from data the page already loads, without calling Stripe.
    - The amount is the Eden Bowls total, else Stripe's amount converted from minor units.
    - A second Eden Bowls invoice for the same Stripe invoice is named in the same row.
    - "Gerar invoice" works without syncing first.
    - The Stripe sync stays as a secondary "Buscar na Stripe" action.
    - It replaces the three sections "Invoices Eden Bowls", "Notas fiscais (NF-e)" and "Faturas Stripe".
  - The result of an action is shown next to the section it came from and clears on its own; errors stay until dismissed.
  - "Reenviar" and "Enviar ao cliente" ask for confirmation and name the email address.
  - Readable names first and technical ids second: a plan summary instead of the `Plan #<id>` fallback, and the cycle date instead of the bare `in_…` id. The `price_…` id moves to the technical block.
  - Brazil delivery: the freight charged at checkout (one value per subscription) next to each courier cost, the customer's phone next to the recipient, and on a narrow screen each delivery is a card with its actions visible.
  - Clearer button labels: "Abrir cadastro" and "Ver checkout" instead of "Cliente" and "Checkout". When "Subtotal do plano" and "1ª fatura (plano)" are equal, only "Subtotal do plano" is shown.
- No cleanup of the duplicate rows: there is no production data yet, and the local rows came from the shared sandbox. The charges row keeps the second one visible.

## Capabilities

### New Capabilities

- `admin-subscription-detail`: what the panel's subscription detail page shows and in what order: the current cycle, the attention block, the charges per Stripe invoice, action feedback, the confirmation before emailing the customer, readable names, and the narrow-screen layout.

### Modified Capabilities

- `stripe-region-config`: a paid invoice is handled only on the endpoint of the account its subscription is stored with.
- `nfe-admin`: the subscription NF-e list returns the invoice id, the missing fields and Bling's named problems.

## Impact

- Backend: `src/services/stripe-webhook.service.js` (`handleInvoicePaid`), `src/services/bling-nfe.service.js` (`listForSubscription` items), tests `tests/stripe-webhook*.test.js` and `tests/bling-nfe*.test.js`. No new route, no route renamed or removed, so `docs/api-routes.json` does not change. No migration.
- Panel (`eden-bowls-admin`): `src/pages/SubscriptionDetailPage.tsx` split into smaller components, `src/lib/nfe.ts` types, `src/lib/paidCycles.ts`, `SubscriptionDetailPage.test.tsx`, and a Playwright screenshot at 1440px and 390px. `contracts/backend-routes.json` does not change.
- Store: none.
