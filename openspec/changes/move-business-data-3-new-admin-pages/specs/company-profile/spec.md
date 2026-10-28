# Spec Delta

## Purpose

Holds the company data printed on invoices and emails, one profile per market, edited in the admin and copied onto each invoice so a reissued PDF keeps the issuer it was numbered with.

## ADDED Requirements

### Requirement: One company profile per market

Each market (BR, US) MUST have one company profile with legal name, tax id, street, complement, city, state, postal code, country, support email and store URL. Legal name, street, city, state, postal code, country, support email and store URL MUST be required. The BR tax id MUST be a CNPJ with valid check digits, stored as `NN.NNN.NNN/NNNN-NN`. The US tax id MAY be empty. The store URL MUST be https. Any invalid field MUST be refused with HTTP 422 `company_profile_invalid`, listing the fields. Reading MUST require `settings.read` (admin, operator and readonly); saving MUST require `settings.company.write` (admin only) and MUST be recorded in the admin audit log as `settings.company.update` with the market and the changed fields.

#### Scenario: Operator reads but cannot save

- **WHEN** an operator opens the BR profile and then tries to save it
- **THEN** the read returns the profile and the save returns 403

#### Scenario: Invalid CNPJ

- **WHEN** an admin saves the BR profile with tax id `11.111.111/1111-11`
- **THEN** the API returns 422 `company_profile_invalid` listing `tax_id`

### Requirement: Profiles keep today's printed data on deploy

The deploy MUST create both profiles with the data printed today: BR "C. C. J. Lovato Ltda", CNPJ 65.291.985/0001-05, Rua Delmiro Fetter dos Santos, 94, Cajuru, Curitiba, PR, 82950-130; US "EZER ONE INC (Eden Bowls)", 6200 NW 2nd Ave, Boca Raton, FL, 33487-3021, USA; both with support email hello@edenbowls.com and store URL https://edenbowls.com. The company address environment variables MUST NOT be read after the deploy.

#### Scenario: Invoice text unchanged after deploy

- **WHEN** the migration runs and a BR invoice and a US invoice are rendered with the preview data
- **THEN** the issuer lines are "Eden Bowls · CNPJ 65.291.985/0001-05 · Curitiba, PR" and "Eden Bowls · Boca Raton, FL, USA", with hello@edenbowls.com, as before the deploy

### Requirement: Invoices and emails read the market profile

The invoice issuer line and support email MUST be composed from the profile of the invoice's market, keeping the approved composition (BR: "Eden Bowls · CNPJ <tax id> · <city>, <state>"; US: "Eden Bowls · <city>, <state>, USA"). The company address of the emails MUST come from the same profile.

#### Scenario: City change reaches new invoices

- **WHEN** an admin changes the BR city to São Paulo, SP and a new BR invoice is issued
- **THEN** its issuer line ends with "São Paulo, SP"

### Requirement: An issued invoice keeps its issuer

When an invoice receives its number, the API MUST store a copy of the issuer data it prints. Writing the PDF again for that invoice, for a missing file or a status change, MUST use the stored copy and not the current profile. The deploy MUST store the current issuer data on every invoice already issued.

#### Scenario: Reissue after a profile change

- **WHEN** invoice EB-2026-000010 was issued in BR, an admin then changes the BR city, and the PDF file of EB-2026-000010 is written again
- **THEN** the reissued PDF prints the original city
