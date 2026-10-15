## MODIFIED Requirements

### Requirement: UPS environment is explicit

The API MUST pass `UPS_CLIENT_ID`, `UPS_CLIENT_SECRET`, and `UPS_ACCOUNT_NUMBER` from the environment into the UPS client. `EDEN_RUNTIME` MUST select the UPS host. When `EDEN_RUNTIME` is `local` or `qa`, the API MUST use `https://wwwcie.ups.com`, `UPS_ENV` MAY be unset, blank, or `cie`, and any other value MUST stop the process before it listens. When `EDEN_RUNTIME` is `production`, `UPS_ENV` MUST be `production`, the API MUST use `https://onlinetools.ups.com`, and an unset, blank, or `cie` value MUST stop the process. The UPS client MUST refuse the production host unless its runtime is `production`.

#### Scenario: Production setting is not discarded

- **WHEN** `EDEN_RUNTIME` is `production`, `UPS_ENV=production`, and the UPS credentials are present
- **THEN** OAuth, rate, shipment, track, and void calls use `https://onlinetools.ups.com`

#### Scenario: Production without UPS_ENV does not boot

- **WHEN** `EDEN_RUNTIME` is `production` and `UPS_ENV` is unset or `cie`
- **THEN** the process exits before listening and does not call `https://wwwcie.ups.com`

#### Scenario: Local and QA stay on CIE

- **WHEN** `EDEN_RUNTIME` is `local` or `qa` and `UPS_ENV` is unset or `cie`
- **THEN** every UPS call uses `https://wwwcie.ups.com`

#### Scenario: Production host outside production does not boot

- **WHEN** `EDEN_RUNTIME` is `local` or `qa` and `UPS_ENV=production`, including when `NODE_ENV` is `production`
- **THEN** the process exits before listening and does not call `https://onlinetools.ups.com`
