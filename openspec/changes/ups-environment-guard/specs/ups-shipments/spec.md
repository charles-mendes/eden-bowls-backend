## ADDED Requirements

### Requirement: One label per invoice

The database MUST hold at most one `ups_shipments` row that is not `voided` for each `stripe_invoice_id`. A create request for an invoice whose row has a UPS shipment id MUST return that row as reused and MUST NOT call UPS. A create request for an invoice whose row is `pending` or `unknown` without a UPS shipment id MUST answer `409 ups_shipment_unresolved` and MUST NOT call UPS.

#### Scenario: Concurrent create requests

- **WHEN** two create requests for the same invoice run at the same time
- **THEN** only one row is inserted, and at most one of them calls UPS ship

#### Scenario: Label already bought

- **WHEN** the invoice already has a `created` row
- **THEN** the request returns that row with `reused: true` and does not call UPS

### Requirement: Unknown label outcome is kept

When the ship call fails with a timeout, a network error, a 5xx, an answer without a tracking number, or an error that is not from UPS, the row MUST become `unknown` and MUST NOT be deleted. The route MUST answer `502 ups_shipment_unknown` with the row id. When the token step fails or UPS answers 4xx, the pending row MUST be deleted. Once UPS returns a label, the row MUST NOT be deleted.

#### Scenario: Ship timeout

- **WHEN** UPS ship times out
- **THEN** the row is `unknown`, the response is `502 ups_shipment_unknown`, and a second request for that invoice answers `409` without calling UPS

#### Scenario: UPS rejects the request

- **WHEN** UPS ship answers 400
- **THEN** the pending row is deleted and the operator can try again

### Requirement: Operator closes an unresolved row

Void on a `pending` or `unknown` row without a UPS shipment id MUST answer `409 ups_shipment_unresolved` unless the body has `confirm_not_created: true`. With that flag the row MUST become `voided` without a UPS call, and the response MUST include `local_only: true`. Void on a row with a UPS shipment id MUST call UPS void.

#### Scenario: Confirmed resolution

- **WHEN** the operator voids an `unknown` row with `{"confirm_not_created": true}`
- **THEN** the row is `voided`, UPS is not called, and a new label can be bought for that invoice

### Requirement: UPS errors and stored responses carry no UPS body

UPS error details MUST carry only the error code, the HTTP status, the UPS error code when present, and the stage for token failures. They MUST NOT include the UPS response body. When the label file is stored, `raw_response` MUST NOT contain `GraphicImage`, `GraphicImagePart`, or `HTMLImage`. When the file cannot be stored, the response MUST be kept with the image. Logs MUST NOT include the UPS client secret, access tokens, or outbound `Authorization` headers.

#### Scenario: UPS rejects a rate request

- **WHEN** UPS answers 400 with an address in its body
- **THEN** the error details are `{ code: 'ups_upstream_error', status: 400, ups_code }` and contain no address

### Requirement: Rejected token is renewed

The OAuth token cache MUST be reused only for the base URL that issued it. A 401 from UPS MUST drop the cached token. Rate, track, and void MUST retry once with a new token. Ship MUST NOT be retried. Each UPS request MUST send a random 32-character `transId`.

#### Scenario: Token revoked during tracking

- **WHEN** UPS answers 401 to a track call with a cached token
- **THEN** the client fetches a new token and repeats the track call once
