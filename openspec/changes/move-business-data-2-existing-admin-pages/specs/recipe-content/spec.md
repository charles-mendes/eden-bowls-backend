# Spec Delta

## ADDED Requirements

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

Activating a variation MUST be refused while its recipe has no stored presentation in the variation's market, reporting `presentation` among the missing activation checks. Removing or invalidating the presentation of a recipe with an active variation MUST NOT be possible, since a presentation is only ever replaced whole.

#### Scenario: New recipe without presentation

- **WHEN** an operator registers `adult-lamb` in BR, fills its image and label, and activates its variation without saving a presentation
- **THEN** the activation is refused with `presentation` among the missing checks

#### Scenario: New recipe goes live without a store deploy

- **WHEN** the operator saves the presentation of `adult-lamb` and activates the variation
- **THEN** the activation succeeds, `adult-lamb` appears in `GET /api/v1/recipes?market=BR`, and its public route returns the presentation
