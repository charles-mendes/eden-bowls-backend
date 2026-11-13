# catalog-products Specification

## Purpose
TBD - created by archiving change product-is-recipe. Update Purpose after archive.

## Requirements

### Requirement: A product is one recipe of one market

Creating a product MUST require a name (1 to 120 characters), a market (BR or US), a code (lowercase letters, digits and single hyphens, up to 64 characters) and a life stage (`adult`, `puppy` or `senior`). The product MUST be created as a draft in the store category `flavors`, with its content record and no image, label or presentation. A code already used by a product of the market MUST be refused with HTTP 409 `product_code_taken`; the same code MAY exist in the other market.

#### Scenario: Create a recipe product

- **WHEN** an operator creates "Receita de Cordeiro" in BR with code `adult-lamb` and life stage `adult`
- **THEN** a draft BR product exists with that name, code and life stage and no variations

#### Scenario: Published recipe product reaches the store

- **WHEN** the BR product `adult-lamb` created in the admin is published with an active variation
- **THEN** `GET /api/v1/products?country=BR` lists it in the `flavors` category

#### Scenario: Code taken in the market

- **WHEN** an operator creates a BR product with code `beef` and BR already has a `beef` product
- **THEN** the API returns 409 `product_code_taken` and no product is created

#### Scenario: Same code in the other market

- **WHEN** an operator creates a US product with code `beef` while BR has a `beef` product
- **THEN** the US product is created with its own empty content

### Requirement: Product code and market do not change

The code and the market of a product MUST NOT change after creation. A PATCH that sends a different code or market MUST be refused with HTTP 422 `product_identity_locked` and change nothing. Name, life stage, aliases and short label MAY be changed, and each change MUST be recorded in the admin audit log with the product id, the market and the previous and new values.

#### Scenario: Change the market

- **WHEN** an operator PATCHes the BR `beef` product with market US
- **THEN** the API returns 422 `product_identity_locked` and the product stays in BR

#### Scenario: Rename keeps the code

- **WHEN** an operator renames the BR `beef` product to "Carne bovina"
- **THEN** the product keeps code `beef` and its variations, and its name is "Carne bovina"

### Requirement: Variations inherit the product's flavor fields

Every variation of a product MUST report the product's name as its flavor, the product's code as its flavor slug, and the product's aliases, life stage and short label. Variation create and edit MUST accept only pack fields (name, SKU, weight, price, NCM, origin, readiness flags) and MUST ignore `recipeKey`, `flavor`, `flavorSlug`, `flavorAliases`, `lifeStage` and `shortLabel`. Changing a flavor field on the product MUST apply to all its variations, active or not.

#### Scenario: Two sizes share the flavor

- **WHEN** the BR `senior-beef` product has 300 g and 500 g variations
- **THEN** both report flavor slug `senior-beef`, life stage `senior` and the product's short label

#### Scenario: Variation sends its own recipe

- **WHEN** an operator saves a variation of the BR `beef` product with `recipeKey` `pork`
- **THEN** the variation still reports flavor slug `beef`

#### Scenario: Life stage change reaches active variations

- **WHEN** an operator changes the life stage of the BR `adult-lamb` product to `senior` while its 300 g variation is active
- **THEN** the 300 g variation reports life stage `senior`

### Requirement: A product has one variation per weight

A product MUST NOT have two variations with the same weight. Creating or editing a variation to a weight another variation of the product already has MUST be refused with HTTP 422 `variation_weight_taken` and change nothing.

#### Scenario: Second 300 g variation

- **WHEN** an operator adds a 300 g variation to the BR `beef` product, which already has one
- **THEN** the API returns 422 `variation_weight_taken`

### Requirement: Deploy splits each plan product into recipe products

The deploy MUST create, for each recipe key used by the variations of a market, one product named after the recipe, with that code and market and the plan product's store category and tags, and MUST move those variations to it keeping their ids, prices, Stripe ids and subscriptions. A registered recipe with no variation MUST become a draft product without variations. The emptied plan product MUST be deleted. Flavor order in the store MUST stay the same.

#### Scenario: Split of the BR plan product

- **WHEN** the migration runs and the BR plan product has `beef` 300 g, `beef` 500 g and `senior-beef` 300 g
- **THEN** BR has a `beef` product with the two `beef` variations and a `senior-beef` product with one, the variation ids are unchanged, and the old plan product no longer exists

#### Scenario: Recipe without variations

- **WHEN** the migration runs and BR has the recipe `senior-lamb` with no variation
- **THEN** BR has a draft `senior-lamb` product with its content and no variations

#### Scenario: Moved variation keeps its Stripe price

- **WHEN** a moved variation is synced to Stripe after the migration with an unchanged price
- **THEN** it keeps its existing Stripe price id and no new price is created

### Requirement: Deploy stops on ambiguous variations

Before changing anything, the deploy MUST check every variation of the plan products and MUST stop without changes, listing each offending variation id and SKU, when a variation has no recipe key, when its flavor slug (the stored slug, else the key of its flavor label) differs from its recipe key, or when its product has no market. A recipe key used by variations but not registered in its market MUST be registered by the deploy, named after the flavor label of its first variation (by menu order, then id) with that variation's life stage, and logged.

#### Scenario: Flavor slug differs from the recipe

- **WHEN** the migration runs and a BR variation has flavor slug `chicken` and recipe key `turkey`
- **THEN** the migration fails naming that variation and the catalog is unchanged

#### Scenario: Seeded recipe never registered

- **WHEN** the migration runs and the US variations with recipe key `senior-beef` exist but US has no `senior-beef` recipe
- **THEN** US gets a `senior-beef` product named after the first variation's flavor label, with both variations, and the registration is logged

### Requirement: Deploy settles diverging flavor copies without stopping

When variations of the same recipe key disagree on aliases or short label, the deploy MUST take the value of the first variation that has one (by menu order, then id) for the product, log the other filled values that differ with variation id and SKU, and continue; an empty value does not count as a disagreement. The product's life stage MUST be the one stored on the recipe; a variation whose life stage differs MUST be rewritten to it and logged. After the deploy every variation MUST report its product's aliases, short label and life stage.

#### Scenario: Different short labels

- **WHEN** the migration runs and the BR `beef` 300 g has short label "Carne" and the 500 g "Bovino"
- **THEN** the `beef` product gets "Carne", both variations report "Carne", the 500 g is logged, and the migration completes

#### Scenario: Life stage differs from the recipe

- **WHEN** the migration runs, the BR recipe `senior-beef` has life stage `senior` and one of its variations has `adult`
- **THEN** that variation reports `senior` after the deploy and is logged

### Requirement: Missing weight of an active variation can be filled

An active variation of a published product MUST stay locked (`409 variation_active_locked`), except when the variation has no weight and the payload carries only its `id` and a non-empty `weight`. That weight MUST be validated like any other (format and unique per product) and nothing else of the variation MUST change.

#### Scenario: Filling a missing weight

- **WHEN** an operator sends `{ variants: [{ id: '2015', weight: '300g' }] }` for the active variation `2015` of a published product, stored without weight
- **THEN** the weight is saved and the variation stays active with its price, SKU and Stripe ids unchanged

#### Scenario: Changing an existing weight stays locked

- **WHEN** the same variation already has `300g` and the payload sends `500g`, or sends the weight with a price
- **THEN** the API responds `409` with code `variation_active_locked` and writes nothing

