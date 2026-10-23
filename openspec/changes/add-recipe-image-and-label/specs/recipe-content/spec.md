# Spec Delta

## Purpose

Registers recipes per market with a name and a key, stores each recipe's banner image and label data, links variations to a registered recipe through an explicit key, validates them, exposes them to the admin and the store, and lets them satisfy the variation activation checks in place of the manual confirmations.

## ADDED Requirements

### Requirement: Recipes are registered with a name and a key

The admin MUST register a recipe per market with a name (1 to 120 characters) and a key of lowercase letters, digits and single hyphens, up to 64 characters. A key already registered in the market MUST be refused with HTTP 409 `recipe_key_taken`, a malformed key with 422 `recipe_key_invalid` and a blank or longer name with 422 `recipe_name_invalid`. The key MUST NOT change after registration; the name MAY be renamed. A registered recipe MAY hold an image and a label before any variation uses it. Registering, renaming and deleting a recipe MUST be recorded in the admin audit log with the market and the key.

#### Scenario: Register a recipe before its variations

- **WHEN** an operator registers `senior-lamb` named "Sênior Cordeiro" in BR and no variation uses it
- **THEN** the recipe can be read, can receive an image and a label, and lists no variations

#### Scenario: Key already registered

- **WHEN** an operator registers `beef` in BR and BR already has `beef`
- **THEN** the API returns 409 `recipe_key_taken` and the existing recipe is unchanged

#### Scenario: Rename keeps the key

- **WHEN** an operator renames `beef` in BR to "Carne bovina"
- **THEN** the recipe keeps the key `beef` and its variations, and the name is "Carne bovina"

### Requirement: A recipe is deleted only without variations

The API MUST refuse to delete a recipe with HTTP 409 `recipe_in_use`, listing the variations that use it, while any variation of the market uses its key. Deleting an unused recipe MUST remove its image file, its label and its registration.

#### Scenario: Delete a recipe in use

- **WHEN** an operator deletes `beef` in BR and the variation SKU 1005 uses `beef`
- **THEN** the API returns 409 `recipe_in_use` naming SKU 1005, and the recipe is kept

#### Scenario: Delete an unused recipe

- **WHEN** an operator deletes `senior-lamb` in BR, which no variation uses and which has an image
- **THEN** the recipe, its label and its image file are removed

### Requirement: Recipe content belongs to a market and a recipe key

Recipe content (image and label) MUST be stored once per registered recipe of a market. A variation MUST use the content of the recipe key stored on it, and every variation of the market with the same key, in any product, MUST read the same content. Reading or changing a key that is not registered in the market MUST answer 404 `recipe_not_found`. The admin read of a recipe MUST give its name and list the variations that use it, with id, name, SKU, active state, product id and product name.

#### Scenario: Two sizes share one image

- **WHEN** an operator uploads the image of `senior-beef` in BR
- **THEN** the product detail of Flavors BR reports that image for both the 300 g and the 500 g variations whose recipe key is `senior-beef`
- **AND** the `senior-beef` variations of Flavors US are unchanged

#### Scenario: A flavor alias does not link a variation

- **WHEN** a BR variation has the flavor "Bovino" and no recipe key
- **THEN** it does not use the `beef` content and is not listed among the `beef` variations

#### Scenario: Unregistered key

- **WHEN** an operator reads `bovino` in BR and BR has no recipe `bovino`
- **THEN** the API returns 404 `recipe_not_found`

### Requirement: Variation recipe key is chosen explicitly

The admin MUST let an operator set or clear a variation's recipe key when creating or editing it, under the same lock as the other variation fields. The key MUST be a recipe registered in the product's market; anything else MUST be refused with HTTP 422 `recipe_not_registered`. An empty key MUST unlink the variation. A new variation sent without a key MUST have none. Every change of the key MUST be recorded in the admin audit log with the previous and the new key.

#### Scenario: Operator unlinks a variation

- **WHEN** an operator saves the inactive variation SKU 3000 with an empty recipe key
- **THEN** it no longer appears among the `beef` variations and its product detail reports no recipe key, no image and label status `missing`

#### Scenario: Unregistered key

- **WHEN** an operator saves a BR variation with the recipe key `senoir-beef` and BR has no such recipe
- **THEN** the API returns 422 `recipe_not_registered` and the variation is unchanged

### Requirement: Existing variations keep the recipe they use today

Deploying the explicit key MUST store, on every existing variation without a recipe key, the key it was derived to before: its flavor slug, or its flavor label when it has no slug, resolved through the flavor aliases. Variations that already have a recipe key MUST keep it. It MUST then register, in each market, every key used by a variation and not yet registered, named after the flavor label of the first variation that uses it, or after the key when there is no label. Rolling the migrations back MUST remove the stored keys and the registrations they created.

#### Scenario: Backfill of an adult chicken variation

- **WHEN** the migration runs on a BR variation with flavor slug `turkey`
- **THEN** the variation gets the recipe key `turkey`

#### Scenario: Backfill through the label alias

- **WHEN** the migration runs on a BR variation with no flavor slug and the flavor label "Bovino"
- **THEN** the variation gets the recipe key `beef`, which the operator can change or clear afterwards

#### Scenario: Registration of the keys in use

- **WHEN** the migrations run and BR variations use `beef` and `senior-beef`, with flavor labels "Carne" and "Receita de Carne para Cães Sênior"
- **THEN** BR has the recipes `beef` named "Carne" and `senior-beef` named "Receita de Carne para Cães Sênior"

### Requirement: Admin lists the recipes of a market

The admin MUST list every recipe registered in a market, each with its key, name, the variations that use it (possibly none), stored image URL and label status.

#### Scenario: Recipes of BR

- **WHEN** an operator lists the recipes of BR, where `beef` and `senior-beef` are used by variations and `senior-lamb` is registered without variations
- **THEN** the list has the three recipes, each with its name, variations and content state, and `senior-lamb` with no variations

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

The admin product detail MUST give each variation its recipe key (or null), the stored image URL of that key (or null) and its label status (`missing`, `incomplete` or `complete`) in that product's market.

#### Scenario: Flavor with stored image and no label

- **WHEN** the admin loads a product whose variation with recipe key `beef` has a stored image and no label
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

`GET /api/v1/recipes/:key?market=BR|US` MUST look up the recipe key as sent and, when no variation of the market uses it, the key its flavor alias resolves to (for example the store key `chicken` to `turkey`). It MUST return the stored image URL and label, each null when not stored. It MUST answer 404 when no active variation of the market uses the key, and 400 for an unknown market. It MUST NOT require authentication.

#### Scenario: Alias resolves

- **WHEN** the store requests `chicken` in US, no variation uses the key `chicken`, and an active Flavors US variation uses `turkey` with a stored image
- **THEN** the route returns that image URL

#### Scenario: Unlaunched recipe is not exposed

- **WHEN** the route is asked for `senior-beef` in BR and no `senior-beef` variation in Flavors BR is active
- **THEN** it returns 404 and no image URL or label
