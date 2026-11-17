# Spec Delta

## MODIFIED Requirements

### Requirement: A recipe is deleted only without variations

The API MUST refuse to delete a recipe with HTTP 409 `recipe_in_use`, listing the variations that use it, while any variation of the market uses its key. Deleting an unused recipe MUST remove its label and its registration. Its banner image and its plan thumbnail MUST only be unlinked: the library images and their files MUST be kept.

#### Scenario: Delete a recipe in use

- **WHEN** an operator deletes `beef` in BR and the variation SKU 1005 uses `beef`
- **THEN** the API returns 409 `recipe_in_use` naming SKU 1005, and the recipe is kept

#### Scenario: Delete an unused recipe

- **WHEN** an operator deletes `senior-lamb` in BR, which no variation uses and which has a banner image
- **THEN** the recipe and its label are removed
- **AND** the banner is still listed in the BR `banner` library, with no recipe in `usedBy`, and its URL still serves the file

#### Scenario: Delete an unused recipe with a plan thumbnail

- **WHEN** an operator deletes `senior-lamb` in BR, which no variation uses and which links to a library plan image
- **THEN** the recipe is removed
- **AND** the library image is still listed in the BR library, with no recipe in `usedBy`, and its URL still serves the file

### Requirement: Recipe image must match the store banner size

The API MUST accept a recipe image only as PNG, JPEG or WebP whose decoded size is exactly 1024 × 636 pixels and whose upload is at most 5 MB. Any other type, size or weight MUST be refused with HTTP 422 `recipe_image_invalid`, with `details` stating what was received and what is expected. A refused upload MUST leave the current image unchanged. An accepted image MUST be served as WebP at the same size. An uploaded image MUST follow the library upload rules of kind `banner`, including same-bytes deduplication, MUST create or reuse a library banner of the recipe's market, and MUST link the recipe to it.

#### Scenario: Wrong dimensions

- **WHEN** an operator uploads a 1200 × 800 PNG
- **THEN** the API returns 422 `recipe_image_invalid` with `details.width` 1200, `details.height` 800, `details.expectedWidth` 1024 and `details.expectedHeight` 636
- **AND** the current image is kept

#### Scenario: Unsupported type

- **WHEN** an operator uploads a GIF of 1024 × 636
- **THEN** the API returns 422 `recipe_image_invalid` naming PNG, JPEG and WebP

#### Scenario: Valid image replaces the old one

- **WHEN** an operator uploads a 1024 × 636 JPEG for a flavor that already has an image
- **THEN** the API returns a new image URL ending in `.webp`, the new URL serves a 1024 × 636 image, and the recipe reports the new URL
- **AND** the previous image is still listed in the market's `banner` library and its URL still serves the file

### Requirement: Image of an active recipe cannot be removed

The API MUST refuse to remove a recipe image with HTTP 409 `recipe_content_in_use` while any variation of that flavor in that market is active. Replacing the image MUST remain allowed while variations are active. Removing the image MUST only unlink it: the recipe MUST then report `imageUrl` and `imageAssetId` as null, and the library banner and its file MUST be kept.

#### Scenario: Remove with an active variation

- **WHEN** an operator removes the image of `beef` in US and a `beef` variation in Flavors US is active
- **THEN** the API returns 409 `recipe_content_in_use` and the image is kept

#### Scenario: Remove with only inactive variations

- **WHEN** an operator removes the image of `senior-beef` in BR and every `senior-beef` variation in Flavors BR is inactive
- **THEN** the content reports no image
- **AND** the banner is still listed in the BR `banner` library, with no recipe in `usedBy`, and its URL still serves the file

### Requirement: Content changes follow catalog permissions and market scope

Reading recipe content MUST require `catalog.read` and changing it MUST require `catalog.write`, both limited to the session's markets. Every image upload, image link, image removal and label save MUST be recorded in the admin audit log with the market and the flavor, and an image change also with the library image id.

#### Scenario: Readonly cannot upload

- **WHEN** a session with only `catalog.read` uploads an image
- **THEN** the API returns 403 and the image is unchanged

#### Scenario: Operator outside the market

- **WHEN** a session limited to BR requests the US content of `beef`
- **THEN** the API returns 403

#### Scenario: Banner link is audited

- **WHEN** an operator links the banner of BR recipe `senior-beef` to library banner 31
- **THEN** the audit log records the image update with market BR, key `senior-beef` and image id 31

## ADDED Requirements

### Requirement: Banner links a recipe to a library image

`PUT /api/v1/admin/catalog/recipe-content/:flavorSlug/image` MUST link the recipe's banner to a library image, given either `{ assetId }` of an existing image or a new image upload, and refuse both or neither with 422 `media_asset_invalid`. The image MUST be of kind `banner`, of the recipe's market, and not archived. The recipe content MUST then report that image's URL as `imageUrl` and its id as `imageAssetId`. A previously linked banner MUST stay in the library.

#### Scenario: Link an existing library banner

- **WHEN** an operator links the banner of BR recipe `senior-beef` to BR banner 31
- **THEN** the recipe content reports `imageAssetId` 31 and `imageUrl` equal to banner 31's URL
- **AND** the public content of `senior-beef` in BR reports the same `imageUrl`

#### Scenario: Plan thumbnail as a banner

- **WHEN** an operator links the banner of BR recipe `beef` to a BR library image of kind `plan`
- **THEN** the API returns 422 `media_asset_invalid` and the current banner is kept

#### Scenario: Banner of another market

- **WHEN** an operator links the banner of BR recipe `beef` to a US banner
- **THEN** the API returns 422 `media_asset_invalid` and the current banner is kept

#### Scenario: Archived banner

- **WHEN** an operator links the banner of BR recipe `beef` to an archived BR banner
- **THEN** the API returns 409 `media_asset_archived` and the current banner is kept

#### Scenario: Unknown image

- **WHEN** an operator links the banner of BR recipe `beef` to an image id that does not exist
- **THEN** the API returns 404 and the current banner is kept

#### Scenario: Unlink and link again

- **WHEN** an operator removes the banner of BR recipe `senior-beef`, whose variations are all inactive, and later links it to the same image id
- **THEN** after linking again `senior-beef` reports the same `imageUrl` as before

### Requirement: Existing banners become library images

Every recipe content that had a banner image before this change MUST be linked to a library image of its market and kind `banner`, with the same URL, so the store keeps showing the same file and the variation activation checks keep seeing a stored image.

#### Scenario: Backfill of a stored banner

- **WHEN** BR recipe `turkey` had banner `/recipe-images/recipe-br-turkey-<id>.webp` before the migration
- **THEN** after the migration `turkey` links to a BR `banner` library image with that URL, and its `imageUrl` is unchanged

#### Scenario: Backfilled banner is not deleted on replace

- **WHEN** an operator uploads a new banner for BR recipe `turkey` after the migration
- **THEN** the backfilled image is still listed in the BR `banner` library and `/recipe-images/recipe-br-turkey-<id>.webp` still serves the file
