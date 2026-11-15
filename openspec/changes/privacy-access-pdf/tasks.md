# Tasks

## 1. API: PDF renderer

- [x] 1.1 Move the shared colors, font registration and logo path of `src/infrastructure/invoices/invoice-pdf-renderer.js` into `src/infrastructure/pdf/brand.js` and make the invoice renderer import them; verify `npx jest --findRelatedTests src/infrastructure/invoices/invoice-pdf-renderer.js` stays green
- [x] 1.2 Add `src/core/privacy-export-copy.js` with pt-BR and en section titles, field labels, source and purpose lines drafted from the policy's "Como usamos as informações", "no record" text, enum translations, the criteria line, the sharing table copied from the policy's "Compartilhamento e transferência internacional", and the "not included" list, plus `resolveExportLocale(row)`; verify with `tests/privacy-export-copy.test.js` (pt/en locale, BR/US fallback, unknown enum printed as is, both languages have the same keys, every recipient of the seeded policy's sharing table appears in the copy)
- [x] 1.3 Add `src/core/privacy-export-document.js` (package → printed strings, pure, like `invoice-document.js`) and `src/infrastructure/privacy/privacy-export-pdf-renderer.js` (`renderPrivacyExportPdf({ pack, requestId, locale })` → Buffer) with the request number, export date, the seven sections, their source and purpose, "no record" for empty ones, the criteria line, the sharing section and the "not included" section; verify with `tests/privacy-export-pdf-renderer.test.js`: the buffer starts with `%PDF`, the printed strings hold a pet name, the "no record" line, "Stripe" and "UPS" in the sharing section, the card line in "not included", and the English titles for `en`, and a package with 60 contacts renders on more than one page

## 2. API: routes

- [x] 2.1 Add `GET /api/v1/privacy/requests/:id/export/pdf` and `GET /api/v1/admin/privacy/requests/:id/export/pdf` in `src/api/routes/privacy.routes.js`, loading the package through `downloadOwnPackage` / `downloadAdminPackage` and answering `application/pdf` with the localized filename; verify with route tests: 200 PDF for an owned verified request, 404 for another customer's request, 422 `no_export_package` for a correction, 422 `identity_unverified` for an unverified e-mail request, 403 without `privacy.requests.read`, and the market scope of the panel route
- [x] 2.2 Run `npm run routes:manifest`, commit `docs/api-routes.json`, and verify `npx jest --runTestsByPath tests/api-routes-manifest.test.js` passes

## 3. Store (eden-bowls): Perfil > Privacidade

- [x] 3.1 Add a `downloadPrivacyPdf(requestId)` helper that fetches the PDF blob with the session token and saves it under the `Content-Disposition` name; verify with a unit test like the one of `customerInvoicesApi.ts`
- [x] 3.2 In `ProfilePrivacySection.tsx`, make an access request download the PDF (on creation and on "baixar de novo") and give a completed portability request two buttons, "Baixar meus dados (PDF)" and "Baixar arquivo para outra empresa (JSON)", with the English copy; verify with `ProfilePrivacySection.test.tsx`: access downloads no JSON, portability shows both buttons in pt-BR and en

## 4. Panel (eden-bowls-admin)

- [x] 4.1 Offer "Tratar" only for open or in-progress requests and "Ver" for completed or rejected ones in `PrivacyRequestsPage.tsx`; verified by `PrivacyRequestsPage.test.tsx` ("offers only Ver for a request that is already closed")
- [x] 4.2 Explain the data package in the request detail by channel, wait for identity before the download, and drop the read-only notice on closed requests; verified by `PrivacyRequestDetailPage.test.tsx`
- [x] 4.3 In `PackageSection`, add "Baixar PDF" (primary, blob fetch of the new admin route) before "Baixar JSON", and rewrite the explanation around the two files by channel and type (e-mail: send the PDF, plus the JSON on portability, after identity; in-app: the customer already got them, download again to resend or check); verify with `PrivacyRequestDetailPage.test.tsx` that both buttons appear in that order for a verified request, that "Baixar PDF" calls `/admin/privacy/requests/:id/export/pdf`, and the text of the e-mail portability and in-app portability cases
- [x] 4.4 Show "Nota da abertura" from `payload.note` in the detail summary, with "(operador)" when `payload.openedBy` is set and "(cliente)" otherwise, apart from the result note; verify with one test per case
- [x] 4.5 Run `npm run contract:sync`, commit `contracts/backend-routes.json`, and verify the panel's Vitest passes for the privacy pages

## 5. Review and integration

- [ ] 5.1 Owner reviews the pt-BR and en source and purpose lines, the criteria line, the sharing table and the "not included" list in `src/core/privacy-export-copy.js` against the privacy policy `2026-09-13` in `legal-documents`, and the review is recorded in this change
- [x] 5.2 Render a sample PDF for a BR and a US customer, attach them to the change, and check the layout against the invoice PDF's look; done with `samples/eden-bowls-dados-BR-access.pdf` (4 pages) and `samples/eden-bowls-data-US-portability.pdf` (5 pages), the PDFs themselves instead of PNG screenshots because this machine has no PDF rasterizer (no poppler, no pdfjs). Checked page by page: same logo, palette, fonts and clay rule as the invoice; a record and the head of a section never split across pages
