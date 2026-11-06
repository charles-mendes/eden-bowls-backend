## ADDED Requirements

### Requirement: Created labels carry their pickup

Every `created` item of `GET /admin/shipments/queue` MUST carry `pickup`: `{ id, pickup_date, status, prn }` of its active pickup (`pending`, `requested` or `unknown`, with a `pending` older than 5 minutes shown as `unknown`), or `null` when it has none. A canceled or not created pickup MUST NOT count.

#### Scenario: Label in a pickup

- **WHEN** a created label belongs to a requested pickup for 2026-11-09 with PRN 2929602E9CP
- **THEN** its item has `pickup` `{ id, pickup_date: "2026-11-09", status: "requested", prn: "2929602E9CP" }`

#### Scenario: Pickup canceled

- **WHEN** a created label's only pickup was canceled
- **THEN** its item has `pickup` null
