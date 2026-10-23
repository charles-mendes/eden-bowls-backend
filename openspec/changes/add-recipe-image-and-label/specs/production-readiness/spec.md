# Spec Delta

## MODIFIED Requirements

### Requirement: Uploaded files and labels survive container replacement

Avatar, pet photo, feedback photo, recipe image, and UPS label bytes MUST be written under configurable directories and MUST survive replacement of the API container. Production compose MUST mount those five directories from persistent volumes. The GeoIP database MAY stay on a read-only mount. UPS label writes MUST NOT target that read-only mount. The API MUST keep serving avatars, pet photos, feedback photos, and recipe images as static files under `/avatars`, `/pet-photos`, `/feedback-photos`, and `/recipe-images`. UPS label download MUST remain the authenticated admin route `GET /api/v1/admin/shipments/:id/label`.

#### Scenario: Label write is not on the read-only data mount

- **WHEN** the API container is started from the QA or local backend compose file
- **THEN** the UPS label directory is a writable persistent mount and is not the read-only `./data` mount used for the GeoIP database

#### Scenario: Public photo URL still resolves

- **WHEN** a pet photo has been stored and a client requests its `/pet-photos/` URL
- **THEN** the file is returned without an auth token

#### Scenario: Recipe image survives a redeploy

- **WHEN** a recipe image has been stored and the API container is replaced from the QA or local backend compose file
- **THEN** the `/recipe-images/` URL of that image still returns the file without an auth token
