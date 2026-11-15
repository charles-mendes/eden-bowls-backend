# nutrition-parameters Specification

## Purpose
Lets the veterinarian edit, version and preview the numbers and breed lists the nutrition recommendation and the life-stage classification use, without a deploy and with a record of which version produced each recommendation.

## Requirements

### Requirement: Energy factors and breed energy groups are a versioned parameter set

The recommendation MUST follow the veterinarian's document `docs-new/Arquivos_veterinaria_nova_analise_calculos/requerimento_energetico.md` and read its numbers from the published nutrition parameter set: the general combination matrix, the giant combination matrix, the state factors, the cat factors (indoor and active) and the default food EM (the API field `nem`, in kcal/kg) for dogs and cats. The default food EM MUST be 1200 kcal/kg for dogs and cats, a fresh-food value; a recipe's own EM wins over it, and the deploy MUST republish a set that still holds the old kibble defaults (3600 for dogs, 3800 for cats) with 1200. It MUST read the giant breed groups (`dogue`, `slow_metabolism`, `terranova`) from the same set. The daily energy MUST be `factor × weight^exponent`. A dog MUST use exponent 0.75; a growing dog MUST get the growth factor of its stage (81–100% when the stage is unknown), a pregnant dog the pregnancy factor and a senior dog the senior factor; any other dog MUST get the castrated × activity × body score factor, from the giant matrix when it weighs more than 40 kg, is declared giant or is in a giant breed group, and from the general matrix otherwise. A cat MUST get the active factor with high activity and the indoor factor otherwise, with exponent 0.67, or 0.4 when its body score is above weight; the combination matrices MUST NOT apply to cats. Exactly one set MUST be published at a time. A set saved before this rule MUST be read with the document's giant matrix and cat factors, and the deploy MUST publish it again with them, keeping its other values. A parameter set MUST apply to both markets.

#### Scenario: Same result after deploy

- **WHEN** the migration runs and the admin simulates any input of the current nutrition tests
- **THEN** the daily kcal, grams and trace are the same as before the deploy

#### Scenario: Recommendation records its version

- **WHEN** a customer gets a recommendation in onboarding
- **THEN** the stored recommendation holds the id of the parameter set that produced it

### Requirement: Publishing a parameter set

A user with `nutrition.settings.write` MUST be able to save a draft, simulate with it and publish it. The admin and veterinarian roles MUST have this permission; operator and readonly MUST NOT. Every factor MUST be a number from 1 to 400 and every food EM a number from 500 to 8000; any other value MUST be refused with HTTP 422 `nutrition_parameters_invalid`, listing the fields. A breed MUST belong to at most one energy group. Publishing MUST make the draft the published set, keep the previous sets read-only, and record `nutrition.parameters.publish` in the admin audit log with the old and new set ids. A published set MUST NOT be edited. A user with `nutrition.simulate` MUST be able to read the published set and the history.

#### Scenario: Simulate with a draft

- **WHEN** a veterinarian changes the Dogue group factor to 190 in a draft and simulates a Great Dane with that draft
- **THEN** the result uses 190, while customer recommendations still use the published 200

#### Scenario: Operator cannot publish

- **WHEN** an operator tries to publish a draft
- **THEN** the API returns 403 and the published set is unchanged

#### Scenario: Breed in two groups

- **WHEN** a draft lists Saint Bernard in both `dogue` and `slow_metabolism`
- **THEN** saving it returns 422 `nutrition_parameters_invalid` naming the breed

### Requirement: Life-stage limits and giant breeds are editable with an impact preview

A user with `nutrition.settings.write` MUST be able to change, per market, the adult and senior months of each size class and the size class of each breed in `life_stage_breeds`, and to add or deactivate a breed. Senior months MUST be greater than adult months, and both MUST be from 1 to 240. Before saving, the API MUST offer a preview that reports how many pets with an active subscription in the market would change life stage, without changing anything. Saving MUST be recorded in the admin audit log as `life_stage.limits.update` or `life_stage.breed.update`. A user with `nutrition.limits.write` or `nutrition.breeds.write` and without `nutrition.settings.write` (the operator) MUST be able to change the limits, or add and edit breeds, and preview that change, only in a market assigned to them; an operator with no assigned market MUST NOT write limits or breeds. The energy factors stay with `nutrition.settings.write`. The overview of a market MUST carry its latest `life_stage.*` audit events (actor, date, before and after), and the parameter-set overview MUST carry its latest `nutrition.parameters.*` events, so the admin shows who edited what. A saved change MUST apply to the next life-stage evaluation in the API and the job processes, with no restart.

#### Scenario: Preview before lowering the senior age

- **WHEN** a veterinarian previews the BR medium senior months lowered from 96 to 84
- **THEN** the API reports the number of BR pets that would become senior, and the stored limits are unchanged

#### Scenario: Invalid limits

- **WHEN** a veterinarian saves BR small with adult 120 and senior 100 months
- **THEN** the API returns 422 and the stored limits are unchanged
