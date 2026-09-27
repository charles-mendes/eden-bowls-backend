# transactional-email-layout Specification

## Purpose

Os e-mails transacionais saem com a casca e a redação da v3 da designer, em português ou inglês, usando só dados que o fluxo já possui e logos hospedados em URL https.

## Requirements

### Requirement: Shared designer shell
Every transactional, OTP, invite, and privacy email SHALL use one HTML shell: a 600px table, dark header with the circular logo at 96px, parchment body, and a footer with the horizontal logo at 132 by 47 pixels. Sent mail MUST use absolute https image sources when an https asset base URL is configured. The shell MUST strip trailing slashes from that base before joining the path, so `https://api.example.com/` and `https://api.example.com` produce the same src. Each logo `img` MUST have `alt="Eden Bowls"`. When the base is missing, empty, or not https, the shell MUST omit both logo `img` tags and keep the Eden Bowls name as readable text. Sent mail MUST NOT use a relative image src. The footer MUST include the support address hello@edenbowls.com and the designer legal line for that locale. The hidden preheader MUST be the designer preheader for that letter. Fonts MUST declare Tenor Sans and Quicksand with Georgia and Segoe UI fallbacks. The system MUST NOT embed SVG or data-URI images.

#### Scenario: Asset base is configured
- **WHEN** a sent email is rendered with asset base `https://api.example.com/`
- **THEN** the header image src is `https://api.example.com/email/logo-circle@2x.png`, the footer image src is `https://api.example.com/email/logo-horizontal@2x.png`, and both images have `alt="Eden Bowls"`

#### Scenario: Asset base is missing or not https
- **WHEN** a sent email is rendered with an empty base, or with an http base
- **THEN** the HTML contains no `img` tag and the Eden Bowls name remains readable as text

### Requirement: Locale copy
The system SHALL render the Portuguese copy from `new-designer-emails/pt` when the locale starts with `pt`, and the English copy from `new-designer-emails/en` otherwise. Subjects MUST match the designer `<title>`. The pet name is substituted only in order confirmed, payment failed, shipped, renewal, paused, resumed, cancelled, and plan changed. Admin new subscription, OTP, invite, password reset, and privacy subjects MUST stay fixed and MUST NOT insert a pet or recipient name. The greeting in the body uses the recipient first name when the designer sentence greets the tutor or the invited person. Sample names in the designer files (Ana, Luna, Lia) MUST NOT be hardcoded in sent mail.

#### Scenario: Brazil locale
- **WHEN** a letter is built with locale `pt-BR` and pet name Luna
- **THEN** the subject and body are the Portuguese designer copy with Luna substituted

#### Scenario: United States locale
- **WHEN** the same letter is built with locale `en-US` and pet name Luna
- **THEN** the subject and body are the English designer copy with Luna substituted

### Requirement: Letter fields use stored data
Each letter MUST show only the fields in the designer file for that template, filled from data the caller already has.

- Order confirmed: pet, plan label, frequency from `subscription_term_months` as months, total, flavor pills, link to the plan dashboard.
- Renewal: pet, amount charged, next delivery date, flavor pills, dashboard link.
- Payment failed: amount, dashboard link to update payment. The pet name appears in the prose.
- Shipped: pet, carrier, tracking code, UPS tracking link.
- Paused: pet, and a planned resume date only when Stripe provides `resumes_at`.
- Resumed: pet and next delivery date.
- Cancelled: pet and the period end date.
- Plan changed: pet, plan label, total, flavor pills, dashboard link.
- Admin new subscription: customer name, email, pet, plan label, total, admin link.
- OTP: the code and the expiry in minutes already passed to the builder.
- Invite: panel URL, login email, temporary password, role label, expiry timestamp, panel link.
- Password reset: the reset link, with no extra account fields.
- Privacy: the one-time confirm link.

The system MUST NOT invent a 14-day cycle, a plan name, or a resume date that is not in the stored subscription or the Stripe payload. The current pause API sets `pause_collection.behavior` to `void` and does not set `resumes_at`. No live flow supplies that timestamp. The resume-date scenario is met by passing a timestamp into the builder.

#### Scenario: Term is stored in months
- **WHEN** an order-confirmed letter is built for a subscription whose term is 3 months
- **THEN** the frequency line says every 3 months in the active locale and does not say 14 days

#### Scenario: Pause has no resume date
- **WHEN** a paused letter is built and Stripe did not send `resumes_at`
- **THEN** the letter does not show a planned resume row

#### Scenario: Pause has a resume date
- **WHEN** a paused letter is built with a timestamp passed in as `resumes_at`, even though no current pause call sets that field
- **THEN** the letter shows that date as the planned resume

### Requirement: Plain text matches the letter facts
Each builder MUST return a plain-text part with the same facts as the HTML body and no logo. For a letter that shows frequency or total, the plain text MUST include that frequency or total. The plain text MUST NOT keep the previous metaphor titles ("A chave da cozinha", "A mesa dos bastidores", "A conta da mesa voltou").

#### Scenario: Order confirmed plain text
- **WHEN** an order-confirmed letter is built for a 3-month term and a stored total
- **THEN** the plain-text part contains the 3-month frequency and that total, and it does not contain "14 dias"

### Requirement: Previews match the builders
Running the existing preview script SHALL write one Portuguese and one English HTML file per letter into `docs-new/Email/previews`, using the same builders as send. The Portuguese file MUST keep the current `{id}.html` name. The English file MUST be `{id}.en.html`. Preview samples MAY use the designer example values. Sent mail MUST NOT use those samples.

#### Scenario: Preview generation
- **WHEN** the preview script runs
- **THEN** `docs-new/Email/previews` contains both `{id}.html` and `{id}.en.html` for every id in `listEmailPreviews()`: otp, password-reset, order-confirmed, payment-failed, shipped, admin-new-subscription, renewal, paused, resumed, cancelled, plan-changed, invite, and privacy, and each file contains the circular logo markup from the shared shell
