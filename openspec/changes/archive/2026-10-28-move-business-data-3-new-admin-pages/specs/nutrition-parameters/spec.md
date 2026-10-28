# Spec Delta

## Purpose

Lets the veterinarian edit, version and preview the numbers and breed lists the nutrition recommendation and the life-stage classification use, without a deploy and with a record of which version produced each recommendation.

## ADDED Requirements

### Requirement: Energy factors and breed energy groups are a versioned parameter set

The recommendation MUST read its numbers from the published nutrition parameter set: the combination factors, the state factors, the base factors (dog base, cat base, cat overweight, high-activity work dog, moderate high-impact, the age 1–2 and 3–7 factors, Newfoundland group, dog overweight, Dogue group and slow-metabolism exception) and the default NEM for dogs and cats. It MUST read the breed energy groups (`dogue`, `slow_metabolism`, `terranova`) from the same set. The order in which the rules apply MUST stay as it is today; only the values become data. Exactly one set MUST be published at a time. The deploy MUST publish a first set with the current values and breed lists, so every recommendation is unchanged. A parameter set MUST apply to both markets.

#### Scenario: Same result after deploy

- **WHEN** the migration runs and the admin simulates any input of the current nutrition tests
- **THEN** the daily kcal, grams and trace are the same as before the deploy

#### Scenario: Recommendation records its version

- **WHEN** a customer gets a recommendation in onboarding
- **THEN** the stored recommendation holds the id of the parameter set that produced it

### Requirement: Publishing a parameter set

A user with `nutrition.settings.write` MUST be able to save a draft, simulate with it and publish it. The admin and veterinarian roles MUST have this permission; operator and readonly MUST NOT. Every factor MUST be a number from 1 to 400 and every NEM a number from 1000 to 8000; any other value MUST be refused with HTTP 422 `nutrition_parameters_invalid`, listing the fields. A breed MUST belong to at most one energy group. Publishing MUST make the draft the published set, keep the previous sets read-only, and record `nutrition.parameters.publish` in the admin audit log with the old and new set ids. A published set MUST NOT be edited. A user with `nutrition.simulate` MUST be able to read the published set and the history.

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

A user with `nutrition.settings.write` MUST be able to change, per market, the adult and senior months of each size class and the size class of each breed in `life_stage_breeds`, and to add or deactivate a breed. Senior months MUST be greater than adult months, and both MUST be from 1 to 240. Before saving, the API MUST offer a preview that reports how many pets with an active subscription in the market would change life stage, without changing anything. Saving MUST be recorded in the admin audit log as `life_stage.limits.update` or `life_stage.breed.update`. A saved change MUST apply to the next life-stage evaluation in the API and the job processes, with no restart.

#### Scenario: Preview before lowering the senior age

- **WHEN** a veterinarian previews the BR medium senior months lowered from 96 to 84
- **THEN** the API reports the number of BR pets that would become senior, and the stored limits are unchanged

#### Scenario: Invalid limits

- **WHEN** a veterinarian saves BR small with adult 120 and senior 100 months
- **THEN** the API returns 422 and the stored limits are unchanged
