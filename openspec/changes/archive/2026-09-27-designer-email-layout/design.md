# Design

## Context

See proposal.md. The 13 designer files match builders that already exist. Send paths that already call them:

| Letter | Builder | Sent today by |
|---|---|---|
| OTP | `buildOtpEmailContent` | auth OTP mailer |
| Invite | `buildInviteEmailContent` | admin user invite |
| Privacy | `buildPrivacyEmailContent` | privacy mailer |
| Order confirmed | `buildOrderConfirmedEmail` | `invoice.paid` + `subscription_create` |
| Admin new subscription | `buildAdminNewSubscriptionEmail` | same first invoice, `MAIL_OPS_TO` |
| Payment failed | `buildPaymentFailedEmail` | `invoice.payment_failed` and `payment_intent.payment_failed` |
| Shipped | `buildShippedEmail` | UPS shipment create |
| Renewal, paused, resumed, cancelled, plan changed, password reset | builders in `transactional-emails.js` | preview only |

`wrapEmailHtml` already has the palette, the 600px table, the button, the code well, and the flavor pills. It does not have the two logos. The masthead is the words "Eden Bowls". Copy and some labels ("Cão" versus "Pet", "Ciclo" versus "Frequência") differ from the v3 files.

Data already on the ledger or the call: customer email, address name, `petsSnapshot`, `planSelection.selected_flavors`, `plan_label`, `subscription_term_months` (1, 3, or 6), invoice amount and currency, `current_period_end`, UPS tracking number, OTP code and TTL, invite name, email, temporary password, role, panel URL, expiry, privacy confirm URL. `pauseSubscription` sets `pause_collection.behavior` to `void` and does not set `resumes_at`.

Previews are written by `src/scripts/render-email-previews.js` to `docs-new/Email/previews/{id}.html` from `listEmailPreviews()`, Portuguese only. `wired` flags in that list are stale (several sent letters are marked false) and are not a source of truth.

Express already serves `public/avatars`, `public/feedback-photos`, and `public/pet-photos`. There is no email asset route. `LEIA-ME.txt` says the HTML `../images/` paths must become public https URLs. Email clients do not load SVG or data URIs.

## Goals / Non-Goals

**Goals:**

- One shell change in `wrapEmailHtml` so every letter picks up the logos and the v3 footer.
- Rewrite each builder's subject, preheader, kicker, title, and body to the designer sentences, with placeholders replaced by caller arguments.
- Host the two PNGs once and point both locales at them.
- Regenerate PT and EN previews from the builders.
- Record the pattern in `.agents/skills/transactional-email-layout/SKILL.md`.

**Non-Goals:**

- New send paths, a password-reset API, a Brazil shipped letter, or a resume date when Stripe does not send one.
- Changing who receives mail or the claim and retry rules. That stays in `complete-transactional-emails`.
- A flavor translation table. Pills show the strings already stored on the plan selection.

## Decisions

### 1. Edit the shell, do not paste 26 HTML files

`wrapEmailHtml` gains the circular logo in the dark header, keeps the "Da cozinha" / "From the kitchen" line under it, and replaces the text wordmark in the footer with the horizontal logo plus the v3 footer sentences. Builders keep composing with `kickerHtml`, `headingHtml`, `paragraphHtml`, `pillsHtml`, `detailsTableHtml`, `buttonHtml`, `codeWellHtml`, and `mutedHtml`.

Alternative considered: store the designer HTML and replace tokens. Rejected because the project already builds HTML in JavaScript and the send path expects `{ subject, text, html }`.

### 2. Asset URL

Copy `logo-circle@2x.png` and `logo-horizontal@2x.png` to `public/email/`. Serve that directory at `/email`, same pattern as `/avatars`. `EMAIL_ASSET_BASE_URL` is the public API origin, no trailing slash (example `https://qa-api.edenbowls.com`). `wrapEmailHtml` receives that base from the mailer options already used for `storeAppUrl`.

Sent mail accepts only an https base. Strip trailing slashes before joining, so `https://qa-api.edenbowls.com/` and `https://qa-api.edenbowls.com` both yield `https://qa-api.edenbowls.com/email/logo-circle@2x.png`. An empty base, an http base, or any other scheme is treated as unset: omit both `img` tags and leave the readable "Eden Bowls" text. Do not emit `../images/` or `images/logo.png` in sent HTML. Each logo `img` has `alt="Eden Bowls"`, so a client that blocks remote images still shows the name.

Preview files cannot use the API origin when someone opens them from disk. The preview script copies the two PNGs to `docs-new/Email/previews/images/` and passes a relative base `images` only for that script, so `images/logo-circle@2x.png` resolves next to the HTML. That relative base is not available to the mailer.

### 3. Copy and fields

Subjects follow the designer `<title>`. Pet name goes in the subject only for order confirmed, payment failed, shipped, renewal, paused, resumed, cancelled, and plan changed. Admin new subscription, OTP, invite, password reset, and privacy keep a fixed subject. The body greeting uses the recipient first name where the designer writes "Oi, Ana" or "Oi, Lia". Body sentences follow the v3 paragraphs, not the current kitchen metaphors ("A chave da cozinha", "A mesa dos bastidores").

Labels: "Pet" in both locales, "Plano" / "Plan", "Frequência" / "Frequency", "Total", "Valor cobrado" / "Charged", "Próxima entrega" / "Next delivery", "Válida até" / "Active until", "Transportadora" / "Carrier".

Frequency text is `A cada N meses` or `Every N months` from `subscription_term_months`. Plan text is `plan_label` as stored. Money stays `formatMoney`. Dates stay Luxon, `America/Sao_Paulo` for pt-BR and `America/New_York` for en-US, only where a timestamp exists.

Paused: pass `resumeAtLabel` only when `resumes_at` is present. `pauseSubscription` never sets that field today, so the date path is exercised by a builder argument in tests, not by a live pause. `detailsTableHtml` must skip rows with an empty value so the em dash is not a fake date. Other letters omit a row the same way when the value is missing, instead of printing a sample.

Plain-text parts carry the same facts as the HTML, without the logo. A letter that shows frequency or total includes those values in `text`. Old metaphor titles do not remain in `text`.

### 4. Previews

Extend `listEmailPreviews` with a locale argument, or call each builder twice. Write `{id}.html` (pt-BR) and `{id}.en.html`. Update the index to list both. Do not treat the `wired` flag as behavior.

### 5. Skill

Add `.agents/skills/transactional-email-layout/SKILL.md` with the usual frontmatter (`name`, `description`). Document the real shell, the helper functions, file locations, asset rule from `LEIA-ME.txt`, subject and preheader, the 600px table, what data each builder accepts, and the steps to add a letter: new builder function, both locales, preview entry, test that the subject and one field match. Do not describe a token-replacement engine that the repo does not have.

## Risks / Trade-offs

- [Email clients strip the Google Fonts `<link>`] → Fallback stacks stay in every inline style, as the designer HTML already does.
- [`EMAIL_ASSET_BASE_URL` unset in production] → Logos are omitted and the name stays in text. QA must set the https origin or the logos will not appear.
- [Flavor pills show raw keys such as `turkey`] → This change does not add a label map. Stored display labels are shown when the snapshot has them.
- [Both this change and `complete-transactional-emails` edit `transactional-emails.js`] → This change only replaces copy and shell inputs. It does not add `notify*` methods. Apply either order, and re-run the template tests after the second.
- [Password reset looks sendable in the preview] → The store still does not call an API. The preview label should say the template is not wired.

## Migration Plan

Deploy the backend with the two PNGs and `EMAIL_ASSET_BASE_URL` set to the public API origin. No database migration. Rollback is reverting the process. Old sent mail is unaffected.

## Open Questions

None.
