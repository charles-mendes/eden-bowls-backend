# Spec Delta

## MODIFIED Requirements

### Requirement: Shared designer shell
Every transactional, OTP, invite, and privacy email SHALL use one HTML shell: a 600px table, dark header with the circular logo at 96px, parchment body, and a footer with the horizontal logo at 132 by 47 pixels. Sent mail MUST use absolute https image sources when an https asset base URL is configured. The shell MUST strip trailing slashes from that base before joining the path, so `https://api.example.com/` and `https://api.example.com` produce the same src. Each logo `img` MUST have `alt="Eden Bowls"`. When the base is missing, empty, or not https, the shell MUST omit both logo `img` tags and keep the Eden Bowls name as readable text. Sent mail MUST NOT use a relative image src. The footer MUST include the support email of the letter's market company profile (hello@edenbowls.com in both markets on deploy) and the designer legal line for that locale. The hidden preheader MUST be the designer preheader for that letter. Fonts MUST declare Tenor Sans and Quicksand with Georgia and Segoe UI fallbacks. The system MUST NOT embed SVG or data-URI images.

#### Scenario: Asset base is configured
- **WHEN** a sent email is rendered with asset base `https://api.example.com/`
- **THEN** the header image src is `https://api.example.com/email/logo-circle@2x.png`, the footer image src is `https://api.example.com/email/logo-horizontal@2x.png`, and both images have `alt="Eden Bowls"`

#### Scenario: Asset base is missing or not https
- **WHEN** a sent email is rendered with an empty base, or with an http base
- **THEN** the HTML contains no `img` tag and the Eden Bowls name remains readable as text

#### Scenario: Support email follows the market profile
- **WHEN** an admin changes the US support email to support@edenbowls.com and a US renewal email is sent
- **THEN** the footer shows support@edenbowls.com, and BR emails still show hello@edenbowls.com
