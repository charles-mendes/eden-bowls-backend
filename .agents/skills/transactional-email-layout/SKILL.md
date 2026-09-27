---
name: transactional-email-layout
description: Build or edit an Eden Bowls transactional email so it matches the designer v3 shell. Use when adding a letter, changing subject or copy, wiring logos, or regenerating email previews.
---

# Transactional email layout

Eden Bowls emails are JavaScript builders that return `{ subject, text, html }`. They share one shell, `wrapEmailHtml` in `src/core/email/html.js`. Do not paste a designer HTML file into the sender.

## Shell

`wrapEmailHtml` renders a 600px table:

- Dark header `#212E25`. With an https asset base, a 96px circular logo (`alt="Eden Bowls"`) and the line "Da cozinha" / "From the kitchen". Without a usable base, the words Eden Bowls stay as text and both `img` tags are omitted.
- Paper body `#FFFBF4` with `kickerHtml`, `headingHtml`, then the letter body.
- Footer with the 132×47 horizontal logo when the base is https, then "E-mail automático da Eden Bowls…" / "Automated email from Eden Bowls…" and the legal line "Nunca compartilhe códigos ou senhas…" / "Never share codes or passwords…". Support address is `hello@edenbowls.com`.
- Hidden preheader div, Tenor Sans and Quicksand with Georgia and Segoe UI fallbacks. Google Fonts links stay; clients that strip them use the fallbacks.
- No SVG and no data-URI images.

Helpers in the same file: `buttonHtml`, `codeWellHtml`, `detailsTableHtml`, `pillsHtml`, `paragraphHtml`, `mutedHtml`. `detailsTableHtml` drops a row whose value is empty. Do not print an em dash as a stand-in date.

## Assets

The two PNGs live once in `public/email/`:

- `logo-circle@2x.png` shown at 96px
- `logo-horizontal@2x.png` shown at 132×47

Express serves that directory at `/email`. `EMAIL_ASSET_BASE_URL` is the public API origin. Sent mail accepts only `https`. Trailing slashes are stripped, so `https://api.example.com/` and `https://api.example.com` both become `https://api.example.com/email/logo-circle@2x.png`. An empty or `http` base omits the images. Pass `assetBaseUrl` from the mailer into the builder and then into `wrapEmailHtml`.

Previews are the exception. `src/scripts/render-email-previews.js` copies the PNGs to `docs-new/Email/previews/images/` and passes `assetBaseUrl: 'images'` with `allowRelativeAssets: true`. Sent mail never sets that flag.

## Locales and subjects

`pt*` uses `new-designer-emails/pt`. Anything else uses `en`. Do not hardcode Ana, Luna, or Lia.

Pet name is in the subject only for order confirmed, payment failed, shipped, renewal, paused, resumed, cancelled, and plan changed. Admin, OTP, invite, password reset, and privacy keep a fixed subject. The body greeting uses the recipient first name.

Frequency is `A cada N meses` / `Every N months` from `subscription_term_months` (1, 3, or 6). The "14 dias" line in the designer HTML is a sample. Plan text is `plan_label`. Money uses `formatMoney`. Dates use the label the caller already formatted. Pause shows "Retomada prevista" only when a resume label is passed. The live pause call does not set `resumes_at`.

Plain text repeats the same facts as the HTML and does not include the logo or the old metaphor titles.

## Files

| Piece | Path |
|---|---|
| Shell and helpers | `src/core/email/html.js` |
| Subscription letters | `src/core/email/transactional-emails.js` |
| OTP | `src/core/otp-email.js` |
| Invite | `src/core/invite-email.js` |
| Privacy | `src/core/privacy-email.js` |
| Ledger fields | `src/core/email/mail-context.js` |
| Preview samples | `src/core/email/preview-fixtures.js` |
| Preview script | `src/scripts/render-email-previews.js` |
| Designer reference | `new-designer-emails/pt` and `new-designer-emails/en` |

## Add a letter

1. Add a `buildXEmail` next to the existing builders. Return `id`, `subject`, `text`, and `html` from `wrapEmailHtml`.
2. Write both locales from the designer file for that letter. Keep the subject rule above.
3. Fill tables only with arguments the caller already has. Skip empty rows.
4. Add one entry per locale in `listEmailPreviews`.
5. Pass `assetBaseUrl` from the mailer that sends it. Do not add a second HTML stack.
6. Assert subject, one stored field, and the plain-text fact in `tests/email-templates.test.js`.
7. Run `npm run email:previews`. It writes `docs-new/Email/previews/{id}.html` and `{id}.en.html`.
