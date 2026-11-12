## MODIFIED Requirements

### Requirement: Unused delete archives Stripe before removing posts

Deleting a product or variation that is not referenced MUST archive each live Stripe product id and only then delete the local posts. Deleting a product MUST also delete its content record and its image and plan image files. If archive of a live Stripe product fails, the local posts and the content MUST remain and the response MUST be 502 `stripe_product_archive_failed`. Seed Stripe ids MUST be skipped and MUST NOT count as failure. Prices MUST NOT be deleted.

#### Scenario: Unused product is removed

- **WHEN** a caller deletes a product that no subscription references and Stripe archive succeeds
- **THEN** the catalog posts are removed and the Stripe products are archived

#### Scenario: Product content goes with the product

- **WHEN** a caller deletes the unused BR `senior-lamb` product, which has an image and a label
- **THEN** its content record and image file are removed and `GET /api/v1/recipes/senior-lamb?market=BR` returns 404

#### Scenario: Archive failure keeps the catalog

- **WHEN** a caller deletes an unreferenced product and Stripe archive fails
- **THEN** the response is 502 `stripe_product_archive_failed` and the catalog posts and the content remain
