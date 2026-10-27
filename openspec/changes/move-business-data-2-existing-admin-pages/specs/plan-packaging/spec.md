# Spec Delta

## Purpose

Defines how the plan recommendation picks the pack size and the pack count for each pet from the market's catalog, so the packs offered always match the variations on sale.

## ADDED Requirements

### Requirement: Pack sizes come from the market's active variations

The recommendation MUST use as pack sizes the distinct weights of the active variations of the market's plan product, in grams. With one size, every pet MUST get that size. With two or more, the small pack MUST be the lightest and the large pack the heaviest. When the market has no active variation, the recommendation MUST use 300 g and 500 g, the values before this change.

#### Scenario: Catalog with 300 g and 500 g

- **WHEN** the BR plan product has active variations of 300 g and 500 g
- **THEN** the recommendation offers 300 g and 500 g packs, as before the deploy

#### Scenario: Operator adds a 1 kg variation

- **WHEN** the BR plan product gains an active 1000 g variation besides 300 g and 500 g
- **THEN** the large pack of the recommendation is 1000 g and `package_sizes_grams` lists 300, 500 and 1000

### Requirement: Plan period and large-pack limit come from the product

The monthly grams of the recommendation MUST use the plan days of the market's plan product (the value the admin edits in the product's "Plano" section) in place of a fixed 30. A pet MUST get the large pack when its monthly grams divided by the small pack size exceeds the product's large-pack limit. The large-pack limit MUST be an integer from 1 to 60, editable with `catalog.write` in the product detail, and set to 8 on deploy. A value outside the range MUST be refused with HTTP 422.

#### Scenario: Values after deploy

- **WHEN** the migration runs and a 20 kg adult dog gets a recommendation in BR
- **THEN** the pack size and count are the same as before the deploy

#### Scenario: Lower large-pack limit

- **WHEN** an operator sets the BR product's large-pack limit to 4 and a pet needs 1,500 g per month
- **THEN** the pet gets the large pack, because 1,500 / 300 = 5 exceeds 4
