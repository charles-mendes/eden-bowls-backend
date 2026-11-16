# Spec Delta

## Purpose

Hands the customer a copy of their data when they ask for access or portability: a readable PDF that a person understands, and a JSON file that another system can reuse.

## ADDED Requirements

### Requirement: The export package is frozen when the request completes
An access or portability request MUST keep the package of the customer's data as it was when the request completed. The PDF and the JSON of a completed request MUST both come from that stored package, so they always show the same data.

#### Scenario: Data changes after completion
- **WHEN** a customer changes their phone after their access request completed, and then downloads the PDF of that request
- **THEN** the PDF shows the phone as it was at completion, the same value the JSON of that request holds

### Requirement: The export package is available as a readable PDF
The API MUST return the export package of an access or portability request as a PDF. The PDF MUST show the request number, the date the data was exported, and one section per kind of data: profile, delivery address, pets, consents, subscriptions, contacts made by Eden Bowls, and address notices.

#### Scenario: Customer with pets and a subscription
- **WHEN** the PDF of a completed access request is downloaded for a customer with two pets and one subscription
- **THEN** the PDF lists both pets and the subscription, each under its own section, with field names a person can read instead of JSON keys

### Requirement: Each PDF section says the source and the purpose of the data
Each section of the PDF MUST say where the data came from and what Eden Bowls uses it for, as LGPD art. 19 II asks. The source and purpose texts MUST be the ones approved against the privacy policy in force (`legal-documents`), in both languages. A section with no data MUST say that there is no record instead of being left out.

#### Scenario: Customer with no address notices
- **WHEN** the PDF is downloaded for a customer who never had an address notice
- **THEN** the address notices section is present and says there is no record

#### Scenario: Every section carries the approved texts
- **WHEN** the PDF is downloaded in pt-BR or in en
- **THEN** each of the seven sections shows a source line and a purpose line taken from the approved copy, and none of them is empty

### Requirement: The PDF states the criteria behind the plan
The PDF MUST say, in one line, that the portion and the plan are calculated from the pet's age, weight, size, activity level and body condition.

#### Scenario: Criteria line
- **WHEN** the PDF of a customer with a pet is downloaded
- **THEN** the PDF shows the line about the criteria used for the portion and the plan

### Requirement: The PDF says who else processes the data
The PDF MUST have a section, the same for every customer, listing the companies that process customer data for Eden Bowls, what for, and where, as published in the privacy policy's sharing table: Stripe, Brevo, MaxMind, Nominatim/OpenStreetMap, ViaCEP, OSRM, UPS and Google Analytics (only when authorized).

#### Scenario: Sharing section
- **WHEN** the PDF is downloaded
- **THEN** it has a sharing section that names Stripe, Brevo, MaxMind, Nominatim/OpenStreetMap, ViaCEP, OSRM, UPS and Google Analytics, each with its purpose and place

### Requirement: The PDF says what it does not include
The PDF MUST list, in a fixed section, the data the policy describes that this file does not carry, and why: the password (kept only as a hash), the profile photo, the pet photo, the card brand and last four digits, the pages visited (held by Google Analytics when authorized) and the country inferred from the IP (calculated on each visit, not saved).

#### Scenario: Customer with a saved card
- **WHEN** the PDF of a customer with a card on file is downloaded
- **THEN** the PDF does not show the card, and the "not included" section says the card brand and last four digits are kept to show the saved method and are not in this file

### Requirement: The PDF follows the request's language
The PDF MUST be in Portuguese for a request with a `pt` locale and in English for an `en` locale. A request without a locale MUST follow its market: BR in Portuguese, US in English. Dates and values MUST use the format of that language.

#### Scenario: US request without locale
- **WHEN** the PDF of a US request with no locale is downloaded
- **THEN** the PDF is in English, with dates in the English format

### Requirement: The PDF and the JSON obey the same access rules
The customer MUST download only the PDF of their own request, and only once their identity is verified. The panel MUST require `privacy.requests.read` and the request's market in the operator's scope. A request that is neither access nor portability MUST answer that it has no export package, as the JSON route does.

#### Scenario: Customer downloads someone else's PDF
- **WHEN** a customer asks for the PDF of a request that belongs to another customer
- **THEN** the API answers 404 and returns no PDF

#### Scenario: Correction request
- **WHEN** the PDF of a correction request is asked for
- **THEN** the API answers 422 with the code `no_export_package`

#### Scenario: Identity not verified
- **WHEN** the panel asks for the PDF of an e-mail access request whose identity is not verified
- **THEN** the API answers 422 with the code `identity_unverified`

### Requirement: The store delivers the format each request needs
In Perfil > Privacidade, an access request MUST download the PDF. A portability request MUST offer the PDF and the JSON as two separate downloads. Each button MUST name what it delivers, in the customer's language.

#### Scenario: Customer asks for access
- **WHEN** the customer asks for access in the profile
- **THEN** the store downloads the PDF and does not download a JSON file

#### Scenario: Customer asks for portability
- **WHEN** the customer opens a completed portability request in the profile
- **THEN** the store shows "Baixar meus dados (PDF)" and "Baixar arquivo para outra empresa (JSON)"
