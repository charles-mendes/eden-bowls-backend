# Proposal

## Why

The admin subscription detail (`/billing/subscriptions/:id`) is organized by data source (Stripe, Bling, courier, checkout), not by the work the operator has to do. A review of subscription 2717 found that the page never says how this month's order stands or what to do next, that a refused NF-e shows only Bling's generic message, that delivery actions are hidden on a phone, and that one Stripe invoice appears in three sections under three names. The same review found two Eden Bowls invoices (`EB-2026-000010` as `br`, `EB-2026-000011` as `us`) for one Stripe invoice. Locally both webhook endpoints share one Stripe sandbox, so the same `invoice.paid` reached both and each issued a PDF. Nothing in the API checks that the delivering endpoint is the subscription's account, so a Brazil customer can get a second invoice in English with the United States issuer.

## What Changes

- **API, webhook**: `invoice.paid` for a subscription already stored with an account is handled only when it arrives on that account's endpoint. On the other endpoint it returns 200, writes nothing (no ledger update, no NF-e row, no invoice PDF, no letter) and logs `account_mismatch`, like the existing `eden_env` marker guard.
- **API, NF-e**: `GET /api/v1/admin/billing/subscriptions/:id/nfe` items also carry `stripe_invoice_id`, `missing_fields` and `bling_problems`, which the note detail already returns, so the subscription page can say what to fix without opening the note.
- **Panel, subscription detail**:
  - A "Ciclo atual" card at the top: the latest paid cycle's stage (paid, in production, ready, out for delivery, delivered, failed), its dates and the one next action, plus the next renewal date without the time.
  - A "Precisa de atenção" block that lists, each with its next step, a refused or blocked NF-e, an open address problem, a delivery lock and a failed delivery.
  - One "Cobranças" section with one row per Stripe invoice, putting the paid cycle, the Eden Bowls invoice and the NF-e side by side. It is built from data the page already loads, without calling Stripe. "Gerar invoice" is available on a paid row with no Eden Bowls invoice, without syncing first. The Stripe sync stays as a secondary "Buscar na Stripe" action for invoices without a cycle. It replaces the three sections "Invoices Eden Bowls", "Notas fiscais (NF-e)" and "Faturas Stripe".
  - The result of an action is shown next to the section it came from and clears on its own; errors stay until dismissed.
  - "Reenviar" and "Enviar ao cliente" ask for confirmation and name the email address.
  - Readable names first and technical ids second: the customer name as the title (email below), a plan summary instead of the `Plan #<id>` fallback, the cycle date instead of the bare `in_…` id. The `price_…` id moves to the technical block.
  - Brazil delivery: the charged freight next to the courier cost, the customer's phone next to the recipient, and on a narrow screen each delivery is a card with its actions visible.
  - Clearer button labels: "Abrir cadastro" and "Ver checkout" instead of "Cliente" and "Checkout". "Subtotal do plano" and "1ª fatura (plano)" are shown once when they are equal.
- No cleanup of the duplicate rows: there is no production data yet, and the local rows came from the shared sandbox.

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
