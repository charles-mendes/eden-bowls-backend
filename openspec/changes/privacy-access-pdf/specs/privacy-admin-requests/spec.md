# Spec Delta

## Purpose

Defines how the admin panel lists and shows customer privacy requests, so the operator knows which requests still need handling and what to hand the customer.

## ADDED Requirements

### Requirement: Only an open request offers "Tratar"
In the privacy queue, a request that is open or in progress MUST offer "Tratar" to an operator with `privacy.requests.write`. A completed or rejected request MUST offer only "Ver", whatever the operator's permissions.

#### Scenario: Completed request in the queue
- **WHEN** an operator with write permission opens the queue and a request is completed
- **THEN** that row offers "Ver" and not "Tratar"

### Requirement: The detail explains the two files
For an access or portability request, the detail MUST explain the PDF (for the person to read) and the JSON (to take the data to another company), why the law requires them, and when each is useful. For an e-mail request, the operator sends the PDF, plus the JSON on portability, only after the identity is confirmed. For an in-app request, the customer already got the PDF on access, or both files on portability; downloading again serves to resend or check.

#### Scenario: E-mail access request
- **WHEN** an operator opens an e-mail access request with verified identity
- **THEN** the screen says to download the PDF and send it to the customer by the account e-mail

#### Scenario: E-mail portability request
- **WHEN** an operator opens an e-mail portability request with verified identity
- **THEN** the screen says to send the PDF for the customer to read and the JSON for the customer to take to another company

#### Scenario: In-app portability request
- **WHEN** an operator opens a completed portability request made in the profile
- **THEN** the screen says the customer already received the PDF and the JSON, and that downloading again serves to resend or check what was delivered

#### Scenario: Identity still pending
- **WHEN** an operator opens an e-mail access request whose identity is not verified
- **THEN** the screen explains the package and says it becomes available once the identity is confirmed, and offers no download

### Requirement: The detail offers the PDF before the JSON
Once the identity is verified, the detail of an access or portability request MUST offer the PDF download first and the JSON download second, each button naming its format.

#### Scenario: Completed access request
- **WHEN** an operator opens a completed access request with verified identity
- **THEN** the screen offers "Baixar PDF" and then "Baixar JSON"

### Requirement: The detail shows the opening note and who wrote it
The detail summary MUST show the note written when the request was opened, labelled "Nota da abertura", apart from the result note written on completion or rejection. When an operator opened the request in the panel, the label MUST say the note was written by the operator.

#### Scenario: Request opened by the customer
- **WHEN** an operator opens a request the customer opened in the profile with the note "corrigir o sobrenome"
- **THEN** the summary shows "Nota da abertura (cliente): corrigir o sobrenome"

#### Scenario: Request opened by an operator
- **WHEN** an operator opens a request another operator opened in the panel with the note "recebido por e-mail"
- **THEN** the summary shows "Nota da abertura (operador): recebido por e-mail"

### Requirement: A closed request shows no misleading read-only notice
The detail of a completed or rejected request MUST NOT tell an operator with write permission that the screen is read-only for lack of permission.

#### Scenario: Closed correction request
- **WHEN** an operator with write permission opens a completed correction request
- **THEN** the screen shows no read-only notice and no package section
