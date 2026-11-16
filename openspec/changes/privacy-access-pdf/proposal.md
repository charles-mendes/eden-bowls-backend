# Proposal

## Why

When a customer asks for **access** or **portability** of their data, the only thing the store or the operator can hand over is a `.json` file (`buildExportPackage` in `src/services/privacy.service.js`). JSON fits portability, because LGPD art. 18 V and art. 19 §3 and the CCPA ask for a format another system can reuse. It does not fit access: LGPD art. 19 II asks for a "declaração clara e completa", including the source of the data and the purpose of each use, and a customer cannot read a `.json`. The admin screen also does not explain what "Baixar pacote" is for, and it hides the note written when the request was opened. The policy also promises information about sharing, which the package never mentions.

## What Changes

- The API renders the export package as a **readable PDF** with the approved Eden Bowls look (fonts, colors and logo of the invoice PDF). The PDF is in Portuguese or English, following the request's locale, with a fallback to the market (BR → pt-BR, US → en-US). Each section of data says where the data came from and what Eden Bowls uses it for, with texts approved against the privacy policy in force. An empty section says there is no record. Fixed sections, the same for every customer, add the criteria behind the plan, the companies that process the data (the policy's sharing table) and what the file does not include (password hash, photos, card brand and last four digits, pages visited, country from the IP).
- New routes return the PDF of an export package: `GET /api/v1/privacy/requests/:id/export/pdf` for the customer and `GET /api/v1/admin/privacy/requests/:id/export/pdf` for the panel. The PDF is built from the same stored package as the JSON, with the same ownership, identity and market rules. The JSON routes stay as they are.
- **Store (Perfil > Privacidade)**: an access request downloads the PDF. A portability request offers two downloads: the PDF to read, and the JSON to take to another company. Each button says what it delivers: "Baixar meus dados (PDF)" and "Baixar arquivo para outra empresa (JSON)", with the same in English.
- **Panel (request detail)**: the "Pacote de dados do cliente" section offers "Baixar PDF" first and "Baixar JSON" second. Its explanation covers both files and when each is useful, by channel. The summary shows the opening note ("Nota da abertura"), says whether the customer or an operator wrote it, and keeps it apart from the result note.
- **Panel (queue)**: "Tratar" only for an open request. A completed or rejected request shows "Ver". The panel already does this in the working tree; this change records it.

## Capabilities

### New Capabilities
- `privacy-data-export`: the copy of the customer's data handed over on an access or portability request, as readable PDF and as JSON, who can download it, and when.
- `privacy-admin-requests`: how the panel lists and shows privacy requests, including which action each row offers and what the detail screen tells the operator.

### Modified Capabilities
None. No main spec covers privacy requests yet.

## Impact

- **API** (`eden-bowls-backend`): a new PDF renderer next to `src/infrastructure/invoices/invoice-pdf-renderer.js`, reusing its fonts and logo assets; two new routes in `src/api/routes/privacy.routes.js`; `docs/api-routes.json` regenerated (`npm run routes:manifest`). No schema change: the package is already stored in `payload.package`.
- **Store** (`eden-bowls`): `ProfilePrivacySection.tsx`, its copy (pt-BR and en), and a PDF download helper like `customerInvoicesApi.ts`.
- **Panel** (`eden-bowls-admin`): `PrivacyRequestDetailPage.tsx`, `PrivacyRequestsPage.tsx`, and `contracts/backend-routes.json` (`npm run contract:sync`).
- **Legal text**: the source and purpose lines in the PDF are product copy that must match the published privacy policy (`legal-documents`). They need the owner's review before going live.
