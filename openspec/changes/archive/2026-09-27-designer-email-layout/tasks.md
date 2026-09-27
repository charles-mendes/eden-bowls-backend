# Tasks

## 1. Shell and assets

- [x] 1.1 Copy `logo-circle@2x.png` and `logo-horizontal@2x.png` to `public/email/` and serve that directory at `/email`. Verify a request to `/email/logo-circle@2x.png` is routed by the static middleware in `src/app.js`
- [x] 1.2 Read `EMAIL_ASSET_BASE_URL` in `src/config/env.js` and pass it into `wrapEmailHtml`. An https base, after trailing slashes are stripped, sets both logo src values and `alt="Eden Bowls"`. An empty or http base omits both `img` tags and keeps the name as text. Verify `npx jest --runTestsByPath tests/email-templates.test.js` covers the https base with a trailing slash, the http base, and the empty base
- [x] 1.3 Update the header and footer copy in `wrapEmailHtml` to the v3 sentences, including hello@edenbowls.com. Verify the same test file asserts the Portuguese and English footer lines

## 2. Letter copy

- [x] 2.1 Rewrite the 13 builders so subject, preheader, title, body, and plain text match `new-designer-emails/pt` and `en`, with caller data substituted. Pet name is in the subject only for order confirmed, payment failed, shipped, renewal, paused, resumed, cancelled, and plan changed. Skip empty detail rows. Frequency uses `subscription_term_months` in months. Verify `npx jest --runTestsByPath tests/email-templates.test.js` for pt-BR and en-US subjects, for a fixed invite subject with no pet name, and for order-confirmed plain text that contains the 3-month frequency and the total and does not contain "14 dias" or "A chave da cozinha"
- [x] 2.2 Omit the paused resume row when `resumes_at` is absent and show it when a timestamp is passed into the builder. The live pause call does not set that field, so the test supplies the timestamp itself. Verify the same test file

## 3. Previews and skill

- [x] 3.1 Generate `{id}.html` and `{id}.en.html` for all 13 letters from the builders, and copy the two PNGs beside the previews so relative image src values resolve. Verify `npm run email:previews` writes both files for every id returned by `listEmailPreviews()`: otp, password-reset, order-confirmed, payment-failed, shipped, admin-new-subscription, renewal, paused, resumed, cancelled, plan-changed, invite, and privacy
- [x] 3.2 Add `.agents/skills/transactional-email-layout/SKILL.md` describing the shell, helpers, assets, data each builder accepts, and how to add a letter. Verify the file exists and names `wrapEmailHtml`, `public/email/`, and both locales
