# Design

## Context

- `PrivacyService.buildExportPackage(userId)` builds the package. It is stored in `payload.package` when an in-app access or portability request is created (completed at once) and when the panel completes one (`completeRequest`). `downloadOwnPackage` and `downloadAdminPackage` return the stored package, or build a live one while there is none (an e-mail request that is still open).
- `src/infrastructure/invoices/invoice-pdf-renderer.js` already renders the approved Eden Bowls PDF with pdfkit, using the Quicksand and Tenor Sans fonts and the logo in `assets/`. The invoice routes return `application/pdf` with `Content-Disposition: attachment`. The store already downloads a PDF from a response blob in `customerInvoicesApi.ts`.
- The panel's `apiRequest` parses JSON. The PDF download needs a blob fetch with the Bearer token, the same way `SubscriptionDetailPage` already downloads a PDF with `response.blob()`.
- The request row has `locale` (sent by the store; the panel sends none on create) and `market`.

## Goals / Non-Goals

**Goals:**
- One renderer that turns any stored or live package into the PDF, in pt-BR or en.
- The PDF and the JSON of a request always come from the same package object.

**Non-Goals:**
- Storing the PDF. It is rendered on each download from the stored package, as the invoice is.
- Sending the PDF by e-mail automatically. The operator still sends it by hand on an e-mail request.
- Changing what the package contains.

## Decisions

### Render on demand from the stored package
The PDF route loads the package through the same service method as the JSON route (`downloadOwnPackage` / `downloadAdminPackage`) and passes it to the renderer. This keeps every access, ownership and identity rule in one place, and the PDF can never disagree with the JSON.
*Alternative*: render once on completion and store the bytes. It was rejected because it means new storage, and the package stored as JSON is already frozen.

### A separate renderer that shares the brand assets
`src/infrastructure/privacy/privacy-export-pdf-renderer.js` exports `renderPrivacyExportPdf({ pack, requestId, locale })` and returns a Buffer. It reuses the font files, logo and color tokens of the invoice renderer. The shared constants move into a small `src/infrastructure/pdf/brand.js` so both renderers read the same palette.
*Alternative*: extend the invoice renderer. It was rejected because the invoice layout is locked by the `eden-invoice` skill, and a data report is a different document.

### Copy lives in one dictionary per language
Section titles, field labels, the "source" and "purpose" lines, "no record" texts, the criteria line, the sharing table and the "not included" list live in `src/core/privacy-export-copy.js` with `pt-BR` and `en` keys. The sharing table and the purposes are copied from the published policy (`legal-documents`, version `2026-09-13`, sections "Como usamos as informações" and "Compartilhamento e transferência internacional"), not written anew; the pet section's purpose is the portion and the plan, not the delivery. The texts are a draft until task 5.1 approves them; the spec requires only that each section carries the approved text. Enum values in the package (activity level, consent type, contact outcome) are translated through the same dictionary. An unknown value is printed as is, never dropped.

### Layout rules found while checking the samples
- A record (one pet, one consent, one contact) and the head of a section (title, source and purpose panel, first record or "no record") never split across pages when they fit on one.
- A US delivery address omits Number and Neighborhood, which exist only in Brazilian addresses.
- Ligatures are off, so "fi" copies out of the PDF as two letters and screen readers read the words whole.

### Language resolution
`resolveExportLocale(row)`: a locale that starts with `pt` gives pt-BR; one that starts with `en` gives en. Otherwise the market decides: BR gives pt-BR and US gives en. Requests opened in the panel carry no locale, so they follow the market.

### Routes
- `GET /api/v1/privacy/requests/:id/export/pdf` (customer, own request).
- `GET /api/v1/admin/privacy/requests/:id/export/pdf` (`privacy.requests.read`, market `record`).

Both answer `application/pdf` with `attachment; filename="eden-bowls-dados-<id>.pdf"` for pt-BR or `eden-bowls-data-<id>.pdf` for en. Errors keep the JSON error envelope of the existing routes (404, 422 `no_export_package`, 422 `identity_unverified`).

### Store and panel downloads
- Store: a `downloadPrivacyPdf(id)` helper fetches the blob and saves it under the name in `Content-Disposition`. When an access request is created, the store now downloads the PDF of the returned request id instead of writing the JSON from `result.package`. Portability shows both buttons.
- Panel: `PackageSection` shows "Baixar PDF" (primary) and "Baixar JSON". The summary adds "Nota da abertura" from `payload.note`, with "(operador)" when `payload.openedBy` is set (`createAdminRequest` stores it) and "(cliente)" otherwise.

## Risks / Trade-offs

- [The source and purpose lines may say something different from the published privacy policy] → The copy dictionary is one file, drafted from the policy text. The owner reviews it against the current `legal-documents` text before the change is archived.
- [The sharing table and the "not included" list go stale when a supplier or a stored field changes] → Both live next to the policy's wording in the copy file, and a test fails if a name of the policy's sharing table is missing from the copy.
- [Long packages (many contacts) overflow a page] → The renderer adds pages, repeats the section title on a new page, and the tests render a package with 60 contacts.
- [Fonts lack a character in a customer's name] → Quicksand covers Latin-1 and Latin Extended-A, like the invoice. The same limitation is accepted there.

## Migration Plan

No data migration. The routes are new and the JSON routes keep working, so the store and the panel can ship in any order after the API. Rollback is to remove the buttons. The API routes can stay.
