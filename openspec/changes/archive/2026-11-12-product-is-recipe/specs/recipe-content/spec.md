## RENAMED Requirements

- FROM: `### Requirement: Recipe content belongs to a market and a recipe key`
- TO: `### Requirement: Recipe content belongs to a product`

## MODIFIED Requirements

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

### Requirement: Image of an active recipe cannot be removed

The API MUST refuse to remove a product's image with HTTP 409 `recipe_content_in_use` while any variation of that product is active. Replacing the image MUST remain allowed while variations are active.

#### Scenario: Remove with an active variation

- **WHEN** an operator removes the image of the US `beef` product and one of its variations is active
- **THEN** the API returns 409 `recipe_content_in_use` and the image is kept

#### Scenario: Remove with only inactive variations

- **WHEN** an operator removes the image of the BR `senior-beef` product and all its variations are inactive
- **THEN** the image is removed and the content reports no image

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

### Requirement: Public route serves launched recipe content

`GET /api/v1/recipes/:key?market=BR|US` MUST look up the product of the market with that code and, when there is none, the code the key's flavor alias resolves to (for example the store key `chicken` to `turkey`). It MUST return the stored image URL and label, each null when not stored. It MUST answer 404 when the product has no active variation, and 400 for an unknown market. It MUST NOT require authentication.

#### Scenario: Alias resolves

- **WHEN** the store requests `chicken` in US, US has no `chicken` product, and the US `turkey` product has an active variation and a stored image
- **THEN** the route returns that image URL

#### Scenario: Unlaunched recipe is not exposed

- **WHEN** the route is asked for `senior-beef` in BR and the BR `senior-beef` product has no active variation
- **THEN** it returns 404 and no image URL or label

### Requirement: Activation requires a stored presentation

Activating a variation MUST be refused while its product has no stored presentation, reporting `presentation` among the missing activation checks. Removing or invalidating the presentation of a product with an active variation MUST NOT be possible, since a presentation is only ever replaced whole.

#### Scenario: New recipe without presentation

- **WHEN** an operator creates the BR product `adult-lamb`, fills its image and label, and activates its variation without saving a presentation
- **THEN** the activation is refused with `presentation` among the missing checks

#### Scenario: New recipe goes live without a store deploy

- **WHEN** the operator saves the presentation of `adult-lamb` and activates the variation
- **THEN** the activation succeeds, `adult-lamb` appears in `GET /api/v1/recipes?market=BR`, and its public route returns the presentation

## REMOVED Requirements

### Requirement: Recipes are registered with a name and a key

**Reason**: A recipe is no longer registered on its own; creating a product creates its content (see `catalog-products`: "A product is one recipe of one market").
**Migration**: Use `POST /api/v1/admin/catalog/products` with name, market, code and life stage; `recipe_key_taken` becomes `product_code_taken`.

### Requirement: A recipe is deleted only without variations

**Reason**: Content is deleted with its product, under the product delete rules (`catalog-product-delete`).
**Migration**: Delete the product; `recipe_in_use` no longer exists, a used product answers `product_in_use`.

### Requirement: Variation recipe key is chosen explicitly

**Reason**: A variation takes the recipe of its product; it has no recipe choice of its own.
**Migration**: Move the size to the product of the wanted recipe (create a variation there and delete the old one when unused).

### Requirement: Existing variations keep the recipe they use today

**Reason**: The one-time backfill already ran; the deploy split of `catalog-products` takes over the existing links.
**Migration**: None.

### Requirement: Admin lists the recipes of a market

**Reason**: The product list is the recipe list.
**Migration**: Use `GET /api/v1/admin/catalog/products?market=`, which reports each product's code, life stage, image and label status.
