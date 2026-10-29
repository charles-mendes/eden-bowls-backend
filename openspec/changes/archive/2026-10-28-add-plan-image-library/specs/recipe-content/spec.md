# Spec Delta

## MODIFIED Requirements

### Requirement: A recipe is deleted only without variations

The API MUST refuse to delete a recipe with HTTP 409 `recipe_in_use`, listing the variations that use it, while any variation of the market uses its key. Deleting an unused recipe MUST remove its banner image file, its label and its registration. Its plan thumbnail MUST only be unlinked: the library image and its file MUST be kept.

#### Scenario: Delete a recipe in use

- **WHEN** an operator deletes `beef` in BR and the variation SKU 1005 uses `beef`
- **THEN** the API returns 409 `recipe_in_use` naming SKU 1005, and the recipe is kept

#### Scenario: Delete an unused recipe

- **WHEN** an operator deletes `senior-lamb` in BR, which no variation uses and which has an image
- **THEN** the recipe, its label and its image file are removed

#### Scenario: Delete an unused recipe with a plan thumbnail

- **WHEN** an operator deletes `senior-lamb` in BR, which no variation uses and which links to a library plan image
- **THEN** the recipe is removed
- **AND** the library image is still listed in the BR library, with no recipe in `usedBy`, and its URL still serves the file

## ADDED Requirements

### Requirement: Plan thumbnail links a recipe to a library image

`PUT /api/v1/admin/catalog/recipe-content/:flavorSlug/plan-image` MUST link the recipe to a library image, given either `{ assetId }` of an existing image or a new image upload. The image MUST be of kind `plan`, of the recipe's market, and not archived. The recipe content MUST then report that image's URL as `planImageUrl`, and its id as `planImageAssetId`. A previously linked image MUST stay in the library.

#### Scenario: Link an existing library image

- **WHEN** an operator links BR recipe `beef` to BR plan image 12
- **THEN** the recipe content reports `planImageAssetId` 12 and `planImageUrl` equal to image 12's URL

#### Scenario: Image of another market

- **WHEN** an operator links BR recipe `beef` to a US plan image
- **THEN** the API returns 422 `media_asset_invalid` and the current thumbnail is kept

#### Scenario: Archived image

- **WHEN** an operator links BR recipe `beef` to an archived BR plan image
- **THEN** the API returns 409 `media_asset_archived` and the current thumbnail is kept

#### Scenario: Unknown image

- **WHEN** an operator links BR recipe `beef` to an image id that does not exist
- **THEN** the API returns 404 and the current thumbnail is kept

### Requirement: A direct plan thumbnail upload goes into the library

A plan thumbnail sent as an upload to `PUT .../plan-image` MUST follow the library upload rules (400 × 400, PNG, JPEG or WebP, up to 5 MB, stored as WebP, same-bytes deduplication), MUST create or reuse a library image of the recipe's market, and MUST link the recipe to it. A refused upload MUST leave the current thumbnail unchanged.

#### Scenario: Upload replaces the linked thumbnail

- **WHEN** BR recipe `beef` links to image A and an operator uploads a new 400 × 400 JPEG to its plan image
- **THEN** a new BR library image B is created and `beef` reports image B's URL
- **AND** image A is still listed in the BR library and its URL still serves the file

#### Scenario: 200 × 200 upload is refused

- **WHEN** an operator uploads a 200 × 200 PNG to the plan image of `beef`
- **THEN** the API returns 422 `recipe_image_invalid` and `beef` keeps its current thumbnail

### Requirement: Unlinking a plan thumbnail keeps the image

`DELETE /api/v1/admin/catalog/recipe-content/:flavorSlug/plan-image` MUST only unlink the recipe from its plan image. The recipe content MUST then report `planImageUrl` and `planImageAssetId` as null. The library image and its file MUST be kept, and the image MAY be linked again.

#### Scenario: Unlink and link again

- **WHEN** an operator unlinks the plan image of BR recipe `beef` and later links `beef` to the same image id
- **THEN** after unlinking `beef` reports no `planImageUrl` and the image is still in the BR library
- **AND** after linking again `beef` reports the same URL as before

### Requirement: Existing plan thumbnails become library images

Every recipe content that had a plan thumbnail before the library existed MUST be linked to a library image of its market and kind `plan`, with the same URL, so the store keeps showing the same file.

#### Scenario: Backfill of a stored thumbnail

- **WHEN** BR recipe `turkey` had plan thumbnail `/recipe-images/recipe-br-turkey-plan-<id>.webp` before the migration
- **THEN** after the migration `turkey` links to a BR plan library image with that URL, and its `planImageUrl` is unchanged

### Requirement: Store plan card falls back from the plan thumbnail

The public recipe content MUST keep reporting `planImageUrl` as the linked library image's URL, or null without one. The store plan card MUST show `planImageUrl`, else the recipe banner `imageUrl`, else the image bundled with the store.

#### Scenario: Recipe without a plan thumbnail

- **WHEN** BR recipe `senior-beef` has a banner image and no plan thumbnail
- **THEN** the public content reports `planImageUrl` null and the plan card shows the banner image

#### Scenario: Unlinked thumbnail leaves the card

- **WHEN** an operator unlinks the plan image of BR recipe `beef`, which has a banner
- **THEN** the store plan card of `beef` shows the banner image

### Requirement: Plan thumbnail changes are audited

Every plan thumbnail link and unlink MUST be recorded in the admin audit log with the market, the recipe key and the library image id.

#### Scenario: Link is audited

- **WHEN** an operator links BR recipe `beef` to image 12
- **THEN** the audit log records the plan image update with market BR, key `beef` and image id 12
