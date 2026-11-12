# recipe-content Specification

## Purpose

Registers recipes per market with a name and a key, stores each recipe's banner image and label data, links variations to a registered recipe through an explicit key, validates them, exposes them to the admin and the store, and lets them satisfy the variation activation checks in place of the manual confirmations.

## Requirements

### Requirement: Recipe content belongs to a product

Recipe content (name, life stage, image, plan image, label and presentation) MUST be stored once per product, and every variation of the product MUST read that content. A product's content MUST be found by its product id and by its market and code. Content of another product, even with the same code in the other market, MUST NOT change. Changing content of a product that does not exist MUST answer 404 `product_not_found`.

#### Scenario: Two sizes share one image

- **WHEN** an operator uploads the image of the BR `senior-beef` product
- **THEN** the product detail reports that image for both its 300 g and 500 g variations
- **AND** the US `senior-beef` product is unchanged

#### Scenario: A flavor alias does not link a variation

- **WHEN** a variation of the BR `pork` product carries the flavor label "Bovino" from before the deploy
- **THEN** it reads the `pork` content and is not listed among the variations of the `beef` product

#### Scenario: Unregistered key

- **WHEN** content is looked up by code `bovino` in BR and no BR product has that code
- **THEN** the lookup finds nothing, and an admin content change for a product id that does not exist returns 404 `product_not_found`

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

The API MUST refuse to remove a product's image with HTTP 409 `recipe_content_in_use` while any variation of that product is active. Replacing the image MUST remain allowed while variations are active.

#### Scenario: Remove with an active variation

- **WHEN** an operator removes the image of the US `beef` product and one of its variations is active
- **THEN** the API returns 409 `recipe_content_in_use` and the image is kept

#### Scenario: Remove with only inactive variations

- **WHEN** an operator removes the image of the BR `senior-beef` product and all its variations are inactive
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

The API MUST refuse with HTTP 409 `recipe_content_in_use` a label change that would make the label of a US product incomplete while any variation of that product is active. Brazil has no such check.

#### Scenario: Clearing analysis of an active US recipe

- **WHEN** an operator removes every analysis row of the US `beef` product while one of its variations is active
- **THEN** the API returns 409 `recipe_content_in_use` and the stored label is unchanged

### Requirement: Stored content satisfies the activation checks

Variation activation MUST treat `final_image` as met when its product has a stored image, or when the variation's manual final-image confirmation is set. It MUST treat `label_data` (US only) as met when its product's stored label is complete, or when the manual label-data confirmation is set. The refusal code `recipe_publish_refused` and the `details.missing` values MUST stay as they are.

#### Scenario: Activation with stored image and no manual confirmation

- **WHEN** an operator activates a BR variation with price, Stripe price and a stored product image, and the manual final-image confirmation is not set
- **THEN** the variation becomes active

#### Scenario: US activation with incomplete stored label

- **WHEN** an operator activates a US variation whose product label has no kcal per package and whose manual label-data confirmation is not set
- **THEN** the API returns 422 `recipe_publish_refused` with `label_data` in `details.missing`

### Requirement: Product detail reports each variation's content

The admin product detail MUST return the product's content (code, name, life stage, aliases, short label, image URL, plan image URL, label with `labelStatus` and missing items, presentation) once, and each variation MUST report the product's image URL (or null) and label status (`missing`, `incomplete` or `complete`).

#### Scenario: Flavor with stored image and no label

- **WHEN** the admin loads the BR `beef` product, which has a stored image and no label
- **THEN** the detail reports the image URL and label status `missing` for the product and for each variation

### Requirement: Content changes follow catalog permissions and market scope

Reading recipe content MUST require `catalog.read` and changing it MUST require `catalog.write`, both limited to the session's markets. Every image upload, image removal and label save MUST be recorded in the admin audit log with the market and the flavor.

#### Scenario: Readonly cannot upload

- **WHEN** a session with only `catalog.read` uploads an image
- **THEN** the API returns 403 and the image is unchanged

#### Scenario: Operator outside the market

- **WHEN** a session limited to BR requests the US content of `beef`
- **THEN** the API returns 403

### Requirement: Public route serves launched recipe content

`GET /api/v1/recipes/:key?market=BR|US` MUST look up the product of the market with that code and, when there is none, the code the key's flavor alias resolves to (for example the store key `chicken` to `turkey`). It MUST return the stored image URL and label, each null when not stored. It MUST answer 404 when the product has no active variation, and 400 for an unknown market. It MUST NOT require authentication.

#### Scenario: Alias resolves

- **WHEN** the store requests `chicken` in US, US has no `chicken` product, and the US `turkey` product has an active variation and a stored image
- **THEN** the route returns that image URL

#### Scenario: Unlaunched recipe is not exposed

- **WHEN** the route is asked for `senior-beef` in BR and the BR `senior-beef` product has no active variation
- **THEN** it returns 404 and no image URL or label

### Requirement: Public list of launched recipes

`GET /api/v1/recipes?market=<BR|US>` MUST return HTTP 200 with every recipe of the market that has at least one active variation in that market, each with its `key`, `name` and `lifeStage` (`adult`, `puppy` or `senior`). A recipe with no active variation in the market MUST NOT be listed. The rule MUST be the same one `GET /api/v1/recipes/:key` uses to answer 404, so a listed key always resolves on that route. A missing or unknown market MUST be refused with HTTP 400 `invalid_market`. The route MUST NOT require authentication and MUST share the rate limit of the single-recipe route. The response MUST NOT include label data or images; the store reads those from the single-recipe route.

#### Scenario: Senior line launched in BR only

- **WHEN** `senior-beef` has an active variation in BR and none in US, and the store requests the list for BR and for US
- **THEN** the BR list contains `senior-beef` with `lifeStage` `senior`, and the US list does not contain it

#### Scenario: Deactivating the last variation removes the recipe

- **WHEN** an operator deactivates the only active variation of `puppy-beef-chicken` in US and the store requests the US list
- **THEN** the list no longer contains `puppy-beef-chicken`, and `GET /api/v1/recipes/puppy-beef-chicken?market=US` returns 404

#### Scenario: Unknown market

- **WHEN** a client requests `GET /api/v1/recipes?market=AR`
- **THEN** the API returns 400 `invalid_market`

### Requirement: Recipe presentation is stored per market in the market language

The admin MUST be able to save, for each registered recipe of a market, a presentation in the market language (BR in pt-BR, US in en-US) with: `tag` (the short name of the store tabs and plan chips, 1 to 40 characters), `title` (1 to 120 characters), `tagline` (1 to 80), `resume` (1 to 300), `highlights` (1 to 8 items, each 1 to 60 characters) and `colors` with the five keys `color`, `accentColor`, `pillBg`, `pillText` and `pillBorder`, each a `#RRGGBB` hex value. A presentation MUST be saved whole: any missing or invalid field MUST be refused with HTTP 422 `recipe_presentation_invalid`, listing the invalid fields, and the stored presentation MUST stay unchanged. Saving MUST require `catalog.write` within the operator's market scope and MUST be recorded in the admin audit log as `catalog.recipe.presentation.update` with the market and the key.

#### Scenario: Save a presentation in BR

- **WHEN** an operator with `catalog.write` in BR saves a complete presentation for `beef`
- **THEN** the BR recipe `beef` holds that presentation, the US recipe `beef` is unchanged, and one audit event is recorded

#### Scenario: Invalid color

- **WHEN** an operator saves a presentation whose `pillBg` is `red`
- **THEN** the API returns 422 `recipe_presentation_invalid` listing `colors.pillBg`, and the stored presentation is unchanged

#### Scenario: Operator outside the market scope

- **WHEN** an operator scoped to US saves a presentation for a BR recipe
- **THEN** the API returns 403 and nothing is stored

### Requirement: Existing recipes keep their store presentation on deploy

The deploy MUST store the presentation the store shows today for the eight store recipes (`beef`, `chicken`/`turkey`, `pork`, `fish`, `puppy-chicken-pork`, `puppy-beef-chicken`, `senior-beef`, `senior-chicken`) in both markets, in each market's language. A presentation already saved in the admin MUST NOT be overwritten.

#### Scenario: Seed after deploy

- **WHEN** the migration runs on a database where no presentation was saved
- **THEN** every registered store recipe in BR and US holds the short name, title, tagline, resume, highlights and colors of the store's current recipe content for that language

#### Scenario: Saved presentation survives a rerun

- **WHEN** an operator saved a presentation for `fish` in US and the migration runs again
- **THEN** the US `fish` presentation is the one the operator saved

### Requirement: Public recipe route serves the presentation

`GET /api/v1/recipes/:key?market=` MUST include the recipe's `name` and its `presentation` (or `null` when none is stored) alongside the image and the label. Each item of `GET /api/v1/recipes?market=` MUST include the presentation `title` and `tag` (or `null`), so the store can name every launched recipe from the list alone.

#### Scenario: Launched recipe with a presentation

- **WHEN** the store requests `senior-beef` in BR and the recipe has an active variation and a stored presentation
- **THEN** the response includes the pt-BR presentation with its title, tagline, resume, highlights and colors

#### Scenario: List names the recipes

- **WHEN** the store requests `GET /api/v1/recipes?market=BR` and `beef` has a stored presentation titled "Receita de Carne"
- **THEN** the `beef` item has `title` "Receita de Carne" and `tag` "Carne", and an item without presentation has both null

#### Scenario: Presentation saved before the short name existed

- **WHEN** a presentation stored without `tag` is migrated
- **THEN** it gets the store's short name for a store recipe (`beef` in BR: "Carne"), else the recipe name, and stays valid

### Requirement: Activation requires a stored presentation

Activating a variation MUST be refused while its product has no stored presentation, reporting `presentation` among the missing activation checks. Removing or invalidating the presentation of a product with an active variation MUST NOT be possible, since a presentation is only ever replaced whole.

#### Scenario: New recipe without presentation

- **WHEN** an operator creates the BR product `adult-lamb`, fills its image and label, and activates its variation without saving a presentation
- **THEN** the activation is refused with `presentation` among the missing checks

#### Scenario: New recipe goes live without a store deploy

- **WHEN** the operator saves the presentation of `adult-lamb` and activates the variation
- **THEN** the activation succeeds, `adult-lamb` appears in `GET /api/v1/recipes?market=BR`, and its public route returns the presentation
