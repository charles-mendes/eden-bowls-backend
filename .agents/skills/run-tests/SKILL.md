---
name: run-tests
description: Run the smallest related Jest subset after a backend change. Use when validating Node/Express/TypeORM code, choosing Jest commands, or tempted to run npm test / the full suite.
---

# Run related Jest tests only

Never run the full suite by default. After changing a file, find related tests, run only those, fix failures, then widen scope if needed.

This backend is CommonJS JavaScript. Tests live in `tests/` as `*.test.js` (not next to source, not TypeScript). Jest is configured in `jest.config.cjs`.

Do not use `npm test`, `npm run test:unit`, or `npm run test:integration` after a small change.

## Know the test file

```bash
npx jest --runTestsByPath tests/auth.service.test.js
npx jest --runTestsByPath tests/onboarding-pets-create.routes.test.js
```

`--runTestsByPath` treats the argument as an exact file. Prefer it when you already know the spec.

## Know the test name

```bash
npx jest tests/onboarding-pets-create.routes.test.js -t "creates a pet for the authenticated user"
npx jest tests/auth.service.test.js -t "returns token payload"
```

## Jest --findRelatedTests

This is the default after editing source. Jest follows `require()` from `tests/` into `src/`:

```text
src/services/auth.service.js
       ↓
Jest --findRelatedTests
       ↓
tests/auth.service.test.js
```

instead of:

```text
src/services/auth.service.js
       ↓
50+ testes
```

```bash
npx jest --findRelatedTests src/services/auth.service.js
npx jest --findRelatedTests src/api/routes/onboarding-pets-create.routes.js
npm run test:related -- src/services/auth.service.js
```

Pass the **source** file, not the test file.

## Jest --changedSince

Useful after a set of Git-related edits:

```bash
npx jest --changedSince=HEAD
npm run test:changed
npx jest --changedSince=main
```

`--changedSince=HEAD` covers uncommitted work. `--changedSince=main` covers the branch vs `main`.

## Integration (MySQL)

Only when the change is persistence, SQL, TypeORM repository, or a migration. These stay skipped unless the env flag is set:

```bash
RUN_DB_INTEGRATION_TESTS=true npx jest --runTestsByPath tests/integration/products.repository.integration.test.js
npm run test:integration
```

Do not turn on `RUN_DB_INTEGRATION_TESTS` for a service or route unit test.

## Full suite

`npm test` / `npm run test:unit` run Jest `--runInBand` against every file in `tests/`. Use that only for high-impact changes (auth, ownership, checkout, Stripe, shared middleware, DataSource, Jest config).
