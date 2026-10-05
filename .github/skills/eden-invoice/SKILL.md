---
name: eden-invoice
description: Keeps the Eden Bowls invoice PDF (EB-YYYY-NNNNNN, EN "INVOICE" / PT "FATURA") on the approved layout. Use whenever a task touches the invoice PDF, its texts, fields, numbering, storage, the invoice email, the admin "Invoices Eden Bowls" section, or asks to change, add, translate or fix anything printed on an invoice/fatura. Also use when someone mentions "invoice personalizada", "fatura", "EB-2026", "customer_invoices" or the invoice PDF layout.
---

# Eden Bowls invoice

The customer invoice is our own PDF, not Stripe's. Stripe stays the source of the money (lines, totals, tax, payment); the API turns each paid Stripe invoice into an Eden Bowls PDF, stores it, and emails it.

The approved layout is `docs-new/FEATURE_CUSTOMIZED_INVOICE/Eden Bowls - Invoice personalizado EN e PT (aprovacao).pdf` (page 1 English, page 2 Portuguese). Any change to what the invoice looks like must still match that file, unless the user approves a new version of it.

## Where everything lives

| Piece | File |
| --- | --- |
| Every fixed text, EN and PT, issuer line, CNPJ, support email, recipe names | `src/core/invoice/invoice-copy.js` |
| Stripe invoice + ledger → strings ready to print (pure, no I/O) | `src/core/invoice/invoice-document.js` |
| Invoice number `EB-YYYY-NNNNNN` and its year | `src/core/invoice/invoice-number.js` |
| Approved sample data (Ana Mendes, Luna, $144.50) | `src/core/invoice/preview-fixtures.js` |
| PDF drawing (pdfkit): positions, colors, fonts, pagination | `src/infrastructure/invoices/invoice-pdf-renderer.js` |
| Fonts (TTF) and logo | `src/infrastructure/invoices/assets/` |
| Issue → store → email, retries, admin actions | `src/services/customer-invoices.service.js` |
| SQL (numbering, rows, price → recipe lookup) | `src/infrastructure/repositories/customer-invoices.repository.js` |
| PDF files on disk (`INVOICE_PDF_DIR`) | `src/infrastructure/storage/local-invoice-storage.js` |
| Tables `customer_invoices`, `customer_invoice_sequences` | `src/infrastructure/migrations/1700000000029-create-customer-invoices.js` |
| Trigger on `invoice.paid` | `prepareCustomerInvoice` / `finishCustomerInvoice` of `StripeWebhookService` in `src/services/stripe-webhook.service.js` |
| Emails with the PDF attached | renewal and order confirmation (`invoiceAttachment` in `src/infrastructure/mailers/transactional-mailer.js`); separate `buildInvoiceEmail` in `src/core/email/transactional-emails.js` |
| Admin routes | `/api/v1/admin/billing/subscriptions/:id/customer-invoices` (GET list, POST issue), `/api/v1/admin/billing/customer-invoices/:id/pdf`, `/:id/send` in `src/api/routes/admin.routes.js` |
| Admin screen | `eden-bowls-admin/src/pages/SubscriptionDetailPage.tsx` (section "Invoices Eden Bowls"), `eden-bowls-admin/src/lib/customerInvoices.ts` |

The store (`eden-bowls`) shows no invoice to the customer. No screen there asks for one; the customer receives the PDF by email. Do not add a download to the store unless the user asks for it.

## Rules that keep the pattern

1. **Texts only in `invoice-copy.js`, always in both languages.** The renderer never holds a sentence. A new label needs an `en-US` and a `pt-BR` entry, with labels in CAPS where the approved layout uses CAPS.
2. **The renderer draws, the document decides.** Formatting money, dates, addresses, which rows exist: `invoice-document.js`. Positions, sizes, colors: `invoice-pdf-renderer.js`. Keep that split; it is what lets tests check every printed string without opening a PDF.
3. **Language and paper follow the market.** Stripe account `br` or a Brazilian address → `pt-BR`, A4, `R$ 1.234,50`, `1 de setembro de 2026`, timezone America/Sao_Paulo. Otherwise → `en-US`, Letter, `$1,234.50`, `September 1, 2026`, America/New_York.
4. **Numbers are never reused or changed.** `EB-<year of issue in the market timezone>-<6 digits>`, from `customer_invoice_sequences` with `LAST_INSERT_ID` on one connection. A Stripe invoice keeps its number forever (unique `stripe_account + stripe_invoice_id`); writing the PDF again (missing file, open → paid) keeps it. Never renumber, never delete rows to "fix" a sequence. A gap can only appear when two deliveries of the same event race; that is accepted.
5. **Only real charges get an invoice.** Status `paid` (or `open` when an operator issues it) and total above zero. A `$0` invoice from a skip or a postponement gets none.
6. **Stripe is the source of the money.** Subtotal = non-shipping lines; Shipping = lines whose product is the shipping product (`shipping_product_id` in the subscription metadata); Discount, Credit applied, Tax come from `total_discount_amounts`, `total - amount_due`, `total_taxes`. Discount and Credit rows appear only when not zero; Shipping and Tax rows always appear, as in the approved layout.
7. **Recipe names follow what the store sells.** `Fresh Bowl · <recipe> <pack size>`: the `turkey` flavor key is sold as Chicken / Frango (see `src/core/market.js`), so it prints "Chicken Recipe" / "Receita de Frango", even though the approved sample says Turkey/Peru. US pack sizes print in oz (`10.6 oz`), Brazilian ones in grams (`300 g`), like the store. A price not found in the catalog falls back to Stripe's line description.
8. **Which email carries the PDF.** The order confirmation (`subscription_create`) and the renewal (`subscription_cycle`) carry the PDF as an attachment, with an "Invoice / Fatura: EB-… (PDF attached / em anexo)" row; that letter going out is the invoice send. A charged plan change, a letter that failed, and "Reenviar" in the admin use the separate invoice email (`buildInvoiceEmail`). The webhook issues the PDF before the letters; if that fails, the letter goes without it and the invoice goes in its own email at the end.
9. **Sending is recorded, never assumed.** `email_status` is `pending`, `sent` (with `email_sent_at` and `email_to`), `failed` (with `email_last_error` and `email_next_attempt_at`, retried by the `invoice_email` job with backoff up to 8 attempts) or `skipped` (no SMTP, outside production). Only `sent` means the customer got it.
10. **The webhook retries on failure.** `finishCustomerInvoice` runs last in `invoice.paid` and throws on a Stripe or disk error, so the event is retried; every earlier step is safe to repeat.
11. **The PDF lives on the API disk and in MySQL.** File `INVOICE_PDF_DIR/<number>.pdf` (Docker volume `eden-bowls-invoices` at `/app/invoices`, shared by `api` and `cron`) plus its SHA-256 in `customer_invoices`. If the file is gone, reading it writes it again from Stripe under the same number.

## Visual tokens (from the approved PDF)

Read `references/layout.md` before moving anything. In short: paper `#FFFBF4`, ink `#212E25`, muted `#5C6758`, clay `#B08F66` (labels, top rule, notes bar), moss `#7B876F` (pay button), panels `#F4EFE3` with border `#D9D1B9`. Display font Tenor Sans (title, headline, Total); body Quicksand Regular, SemiBold for "Amount due / Valor a pagar". 50 pt side margins. Status pill peach for due, sage for paid.

## Changing the invoice

1. Change the text in `invoice-copy.js`, the logic in `invoice-document.js`, or the drawing in `invoice-pdf-renderer.js`.
2. Update `tests/invoice-document.test.js` (it asserts the exact approved strings in both languages) and, if pagination or size changed, `tests/invoice-pdf-renderer.test.js`.
3. Render the previews and compare them with the approved PDF, page by page, at the same zoom:
   ```bash
   npm run invoice:previews -- /tmp/invoice-previews   # en-US/pt-BR × due/paid
   ```
   Check: logo top left, title and number top right, status pill, clay rule, three columns (dates, bill to, ship to), summary panel, table, totals block on the right half, notes panel with the clay bar, footer with the page counter. Everything must fit on one page with the sample data.
4. Run the related tests only:
   ```bash
   npx jest --runTestsByPath tests/invoice-document.test.js tests/invoice-pdf-renderer.test.js tests/customer-invoices.service.test.js tests/customer-invoices.repository.test.js tests/customer-invoices.routes.test.js
   RUN_DB_INTEGRATION_TESTS=true npx jest --runTestsByPath tests/integration/customer-invoices.integration.test.js
   ```
   In the admin: `npx vitest run src/pages/SubscriptionDetailPage.test.tsx` and `npx playwright test e2e/specs/admin-billing.spec.ts --workers=4`.

## Known traps

- **Fonts must be TTF.** pdfkit/fontkit breaks on the composite glyphs (ã, ç, é) of WOFF2 files. Quicksand is the static 400/600 instance, not the variable font (its default instance is Light and looks too thin). Only the Latin subset is embedded: a name with letters outside Latin-1 (ł, ő…) prints with missing glyphs.
- **`last_value` and `year` are MySQL reserved words**; keep them in backticks.
- **Pet names in Portuguese** print without an article ("alimentar Luna"), because the API does not know the pet's gender. The approved sample says "a Luna".
- **Stripe's own emails.** The Stripe Dashboard settings "Email finalized invoices" and "Successful payments" (receipts) must stay off on both accounts (US and BR), or the customer gets a second, Stripe-branded invoice.
- **The Brazilian "Fatura" is not a nota fiscal.** It does not replace an NF-e; do not print tax-document wording on it.
- Issuer data (Boca Raton address, CNPJ 65.291.985/0001-05, Curitiba) is fixed in `invoice-copy.js`; a change of company data is a change there plus a new approved PDF.
