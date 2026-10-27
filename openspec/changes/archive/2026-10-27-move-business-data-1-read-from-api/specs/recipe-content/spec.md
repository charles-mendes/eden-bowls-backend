# Spec Delta

## ADDED Requirements

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
