# Spec Delta

## RENAMED Requirements

- FROM: `### Requirement: Library images are uploaded per market as 400 × 400 WebP`
- TO: `### Requirement: Library images are uploaded per market at the size of their kind`

## MODIFIED Requirements

### Requirement: Library images are uploaded per market at the size of their kind

`POST /api/v1/admin/media` MUST accept one image per request with `kind` `plan` or `banner`, a market, the original file name, a MIME type and base64 data. The image MUST be PNG, JPEG or WebP, at most 5 MB, and exactly 400 × 400 pixels for `plan` or 1024 × 636 pixels for `banner`; anything else MUST be refused with HTTP 422 `recipe_image_invalid` and nothing stored. An accepted image MUST be stored as WebP at its size under a URL that is new for every stored file.

#### Scenario: Upload a 400 × 400 PNG

- **WHEN** an operator uploads `adulto-carne_400.png`, a 400 × 400 PNG, as kind `plan` for BR
- **THEN** the API returns 201 with a library image of market BR, kind `plan`, original file name `adulto-carne_400.png`, width 400, height 400, not archived, and a `/recipe-images/` URL ending in `.webp`
- **AND** that URL serves a 400 × 400 WebP without an auth token

#### Scenario: Upload a 1024 × 636 banner

- **WHEN** an operator uploads `filhote-frango-porco.png`, a 1024 × 636 PNG, as kind `banner` for BR
- **THEN** the API returns 201 with a library image of market BR, kind `banner`, original file name `filhote-frango-porco.png`, width 1024, height 636, not archived, and a `/recipe-images/` URL ending in `.webp`
- **AND** that URL serves a 1024 × 636 WebP without an auth token

#### Scenario: 200 × 200 image is refused

- **WHEN** an operator uploads `adulto-carne_200.png`, a 200 × 200 PNG, as kind `plan`
- **THEN** the API returns 422 `recipe_image_invalid` with `details.width` 200, `details.expectedWidth` 400 and `details.expectedHeight` 400
- **AND** no library image is created

#### Scenario: Plan-sized image as a banner is refused

- **WHEN** an operator uploads a 400 × 400 PNG as kind `banner`
- **THEN** the API returns 422 `recipe_image_invalid` with `details.width` 400, `details.expectedWidth` 1024 and `details.expectedHeight` 636
- **AND** no library image is created

#### Scenario: Unknown kind

- **WHEN** an operator uploads an image with kind `avatar`
- **THEN** the API returns 422 `media_asset_invalid` and no library image is created

### Requirement: Library lists images with the recipes that use them

`GET /api/v1/admin/media` MUST list the library images of the requested market and kind, newest first, leaving archived images out unless `archived=true` is requested. Each image MUST report the recipes of its market that link to it, by key and name, so the admin can show "Adulto Carne (BR)". A `plan` image is used by the recipes whose plan thumbnail links to it, and a `banner` image by the recipes whose banner links to it.

#### Scenario: Image in use

- **WHEN** the BR recipe `beef` named "Adulto Carne" links to a library image and an operator lists the BR `plan` library
- **THEN** that image reports `usedBy` with key `beef` and name "Adulto Carne"

#### Scenario: Banner in use

- **WHEN** the BR recipe `puppy-chicken-pork` named "Filhote Frango e Porco" has its banner linked to a library image and an operator lists the BR `banner` library
- **THEN** that image reports `usedBy` with key `puppy-chicken-pork` and name "Filhote Frango e Porco"

#### Scenario: Archived images are hidden by default

- **WHEN** BR has one archived and one active plan image and an operator lists the BR `plan` library without `archived`
- **THEN** only the active image is listed
- **AND** listing with `archived=true` returns only the archived image

### Requirement: An image in use cannot be archived

Archiving a library image MUST be refused with HTTP 409 `media_asset_in_use`, naming the recipes that link to it, while any recipe links to it. Archiving an unused image MUST mark it archived and keep its file served at the same URL. Restoring MUST clear the archived mark. Archiving or restoring an image already in that state MUST succeed without change.

#### Scenario: Archive an image in use

- **WHEN** an operator archives the BR image linked by `beef`
- **THEN** the API returns 409 `media_asset_in_use` with `details.usedBy` naming `beef` "Adulto Carne"
- **AND** the image stays active

#### Scenario: Archive a banner in use

- **WHEN** an operator archives the BR banner linked by `senior-beef`
- **THEN** the API returns 409 `media_asset_in_use` with `details.usedBy` naming `senior-beef`
- **AND** the banner stays active

#### Scenario: Archive and restore an unused image

- **WHEN** an operator archives a BR image no recipe uses, and then restores it
- **THEN** after archiving it is listed only with `archived=true` and its URL still serves the file
- **AND** after restoring it is listed again without `archived`

### Requirement: Library image files are never deleted by the API

No admin action MUST remove a library image's record or its file: not replacing a recipe's thumbnail or banner, not unlinking it, not deleting the recipe, and not archiving the image. The API MUST NOT offer a route that deletes a library image.

#### Scenario: Replaced thumbnail stays served

- **WHEN** the BR recipe `beef` links to image A and an operator links it to image B
- **THEN** image A is still listed in the BR library and its URL still serves the file

#### Scenario: Replaced banner stays served

- **WHEN** the banner of BR recipe `senior-beef` links to banner A and an operator uploads a new 1024 × 636 banner for it
- **THEN** banner A is still listed in the BR `banner` library and its URL still serves the file

#### Scenario: No delete route

- **WHEN** a client sends `DELETE /api/v1/admin/media/:id`
- **THEN** the API returns 404 and the image is unchanged
