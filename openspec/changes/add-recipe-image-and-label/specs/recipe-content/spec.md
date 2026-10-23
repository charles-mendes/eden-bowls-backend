# Spec Delta

## Purpose

Stores each recipe's banner image and label data per market and flavor, validates them, exposes them to the admin and the store, and lets them satisfy the variation activation checks in place of the manual confirmations.

## ADDED Requirements

### Requirement: Recipe content belongs to a market and a flavor

Recipe content (image and label) MUST be stored once per market and flavor slug. Every variation of that flavor in that market's product MUST read the same content. The admin read of a recipe's content MUST list the variations that share it, with id, name, SKU and active state.

#### Scenario: Two sizes share one image

- **WHEN** an operator uploads the image of `senior-beef` in BR
- **THEN** the product detail of Flavors BR reports that image for both the 300 g and the 500 g `senior-beef` variations
- **AND** the `senior-beef` variations of Flavors US are unchanged

### Requirement: Recipe image must match the store banner size

The API MUST accept a recipe image only as PNG, JPEG or WebP whose decoded size is exactly 1024 × 636 pixels and whose upload is at most 5 MB. Any other type, size or weight MUST be refused with HTTP 422 `recipe_image_invalid`, with `details` stating what was received and what is expected. A refused upload MUST leave the current image unchanged. An accepted image MUST be served as WebP at the same size.

#### Scenario: Wrong dimensions

- **WHEN** an operator uploads a 1200 × 800 PNG
- **THEN** the API returns 422 `recipe_image_invalid` with `details.width` 1200, `details.height` 800, `details.expectedWidth` 1024 and `details.expectedHeight` 636
- **AND** the current image is kept

#### Scenario: Unsupported type

- **WHEN** an operator uploads a GIF of 1024 × 636
- **THEN** the API returns 422 `recipe_image_invalid` naming PNG, JPEG and WebP

#### Scenario: Valid image replaces the old one

- **WHEN** an operator uploads a 1024 × 636 JPEG for a flavor that already has an image
- **THEN** the API returns a new image URL ending in `.webp`, the new URL serves a 1024 × 636 image, and the previous file is no longer served

### Requirement: Image of an active recipe cannot be removed

The API MUST refuse to remove a recipe image with HTTP 409 `recipe_content_in_use` while any variation of that flavor in that market is active. Replacing the image MUST remain allowed while variations are active.

#### Scenario: Remove with an active variation

- **WHEN** an operator removes the image of `beef` in US and a `beef` variation in Flavors US is active
- **THEN** the API returns 409 `recipe_content_in_use` and the image is kept

#### Scenario: Remove with only inactive variations

- **WHEN** an operator removes the image of `senior-beef` in BR and every `senior-beef` variation in Flavors BR is inactive
- **THEN** the image is removed and the content reports no image

### Requirement: Label data is stored per market in the market language

The label MUST hold product name, net weight, freshness note, ingredients, guaranteed analysis rows (nutrient and value), kcal per kg, kcal per package, notices, storage lines, feeding lines, manufacturer and manufacturer address. BR content is Portuguese and US content is English. An incomplete label MUST be accepted and stored. The admin read MUST report `labelStatus` as `missing`, `incomplete` or `complete`, and name each missing item.

#### Scenario: Incomplete label is stored as a draft

- **WHEN** an operator saves a US label with ingredients and no analysis rows
- **THEN** the API stores it, reports `labelStatus` `incomplete` and names the missing analysis

### Requirement: Label completeness depends on the market

A label MUST be complete when it has at least one ingredient, at least one analysis row, kcal per kg and kcal per package. A US label MUST also have at least one notice. The API MUST NOT require a specific notice text. A BR label MUST NOT require notices.

#### Scenario: US label with the current notices

- **WHEN** an operator saves a US label with ingredients, analysis rows, kcal per kg, kcal per package and at least one notice
- **THEN** the API reports `labelStatus` `complete`

#### Scenario: US label without notices

- **WHEN** an operator saves a US label with ingredients, analysis rows, kcal per kg and kcal per package and no notice
- **THEN** the API reports `labelStatus` `incomplete` and names the missing notices

#### Scenario: US label with a different AAFCO statement

- **WHEN** an operator saves a complete US label whose only notice is a growth-formulation AAFCO statement
- **THEN** the API reports `labelStatus` `complete`

#### Scenario: BR label without notices

- **WHEN** an operator saves a BR label with ingredients, analysis rows, kcal per kg and kcal per package and no notice
- **THEN** the API reports `labelStatus` `complete`

### Requirement: Label of an active US recipe stays complete

The API MUST refuse with HTTP 409 `recipe_content_in_use` a label change that would make the label of a US flavor incomplete while any variation of that flavor in Flavors US is active. Brazil has no such check.

#### Scenario: Clearing analysis of an active US recipe

- **WHEN** an operator removes every analysis row of `beef` in US while a `beef` variation in Flavors US is active
- **THEN** the API returns 409 `recipe_content_in_use` and the stored label is unchanged

### Requirement: Stored content satisfies the activation checks

Variation activation MUST treat `final_image` as met when the flavor has a stored image in that market, or when the variation's manual final-image confirmation is set. It MUST treat `label_data` (US only) as met when the flavor's stored US label is complete, or when the manual label-data confirmation is set. The refusal code `recipe_publish_refused` and the `details.missing` values MUST stay as they are.

#### Scenario: Activation with stored image and no manual confirmation

- **WHEN** an operator activates a BR variation with price, Stripe price and a stored image, and the manual final-image confirmation is not set
- **THEN** the variation becomes active

#### Scenario: US activation with incomplete stored label

- **WHEN** an operator activates a US variation whose stored label has no kcal per package and whose manual label-data confirmation is not set
- **THEN** the API returns 422 `recipe_publish_refused` with `label_data` in `details.missing`

### Requirement: Product detail reports each variation's content

The admin product detail MUST give each variation its flavor's stored image URL (or null) and label status (`missing`, `incomplete` or `complete`) in that product's market.

#### Scenario: Flavor with stored image and no label

- **WHEN** the admin loads a product whose `beef` variation has a stored image and no label
- **THEN** that variation reports the image URL and label status `missing`

### Requirement: Content changes follow catalog permissions and market scope

Reading recipe content MUST require `catalog.read` and changing it MUST require `catalog.write`, both limited to the session's markets. Every image upload, image removal and label save MUST be recorded in the admin audit log with the market and the flavor.

#### Scenario: Readonly cannot upload

- **WHEN** a session with only `catalog.read` uploads an image
- **THEN** the API returns 403 and the image is unchanged

#### Scenario: Operator outside the market

- **WHEN** a session limited to BR requests the US content of `beef`
- **THEN** the API returns 403

### Requirement: Public route serves launched recipe content

`GET /api/v1/recipes/:key?market=BR|US` MUST resolve flavor aliases (for example `chicken` to `turkey`) and return the stored image URL and label, each null when not stored. It MUST answer 404 when the flavor has no active variation in that market, and 400 for an unknown market. It MUST NOT require authentication.

#### Scenario: Alias resolves

- **WHEN** the store requests `chicken` in US and `turkey` has an active variation and a stored image in Flavors US
- **THEN** the route returns that image URL

#### Scenario: Unlaunched recipe is not exposed

- **WHEN** the route is asked for `senior-beef` in BR and no `senior-beef` variation in Flavors BR is active
- **THEN** it returns 404 and no image URL or label
