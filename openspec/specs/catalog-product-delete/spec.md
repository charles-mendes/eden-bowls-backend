# catalog-product-delete Specification

## Purpose

Stops admin catalog delete from removing a product or variation that a subscription already bills, and refuses to drop the local record when Stripe archive fails.

## Requirements

### Requirement: Catalog reads report whether delete is allowed

Admin catalog list and product detail MUST include `canDelete` on each product and on each variation. `canDelete` MUST be false when any subscription references that variation id or any of its Stripe price ids, including a price that appears only inside `plan_selection` line items and not on the subscription’s price column. A product MUST have `canDelete` false when any of its variations does. The payload MUST NOT require a subscription count.

#### Scenario: Price stored only on a line item

- **WHEN** a subscription’s price column does not match the variation, but a line item in `plan_selection` does
- **THEN** that variation and its parent product are returned with `canDelete` false

#### Scenario: Unused variation on a used product

- **WHEN** a product has one variation referenced by a subscription and another variation that is not
- **THEN** the product is returned with `canDelete` false, the referenced variation with `canDelete` false, and the other variation with `canDelete` true

### Requirement: Delete of a used catalog record is rejected

Deleting a product or variation that is referenced by a subscription MUST respond 409 with `product_in_use` or `variation_in_use`, MUST NOT archive anything in Stripe, and MUST leave the catalog posts in place. Deleting a product MUST be rejected when any of its variations is referenced, even if the caller asked to delete the parent.

#### Scenario: Delete product with one used variation

- **WHEN** a caller deletes a product whose variation is referenced by a subscription
- **THEN** the response is 409 `product_in_use`, the posts remain, and Stripe is not called

#### Scenario: Delete only the unused variation

- **WHEN** a caller deletes a variation that no subscription references, on a product that has another referenced variation
- **THEN** that variation is removed and the referenced variation remains

#### Scenario: Delete the used variation

- **WHEN** a caller deletes a variation that a subscription references
- **THEN** the response is 409 `variation_in_use` and that variation remains

### Requirement: Unused delete archives Stripe before removing posts

Deleting a product or variation that is not referenced MUST archive each live Stripe product id and only then delete the local posts. If archive of a live Stripe product fails, the local posts MUST remain and the response MUST be 502 `stripe_product_archive_failed`. Seed Stripe ids MUST be skipped and MUST NOT count as failure. Prices MUST NOT be deleted.

#### Scenario: Unused product is removed

- **WHEN** a caller deletes a product that no subscription references and Stripe archive succeeds
- **THEN** the catalog posts are removed and the Stripe products are archived

#### Scenario: Archive failure keeps the catalog

- **WHEN** a caller deletes an unreferenced product and Stripe archive fails
- **THEN** the response is 502 `stripe_product_archive_failed` and the catalog posts remain
