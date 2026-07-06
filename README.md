# Eden Bowls Backend

Backend monorepo focused on a NestJS API with Prisma + MySQL.

## Architecture Snapshot

- Cross-cutting concerns:
  - Auth (`AuthModule`) and Audit (`AuditModule`) are global modules, imported once in `AppModule`.
  - Feature modules no longer need manual imports for these concerns.
- Bounded contexts:
  - `CatalogModule`: public read-model endpoints consumed by clients (`/catalog/categories`, `/catalog/products`, `/catalog/products/:id/variants`, `/catalog/plans`, `/catalog/plans/:planId`).
  - `ProductsModule`: product domain and product administration (`/admin/catalog/products...`).
  - `PricingModule`: pricing domain logic (plan pricing rules, plan calculations, discounts, pricing administration) and pricing endpoints (`/catalog/plans/calculate`, `/admin/catalog/pricing...`).

## Architecture Diagram

```mermaid
flowchart LR
  App[AppModule]

  Auth[AuthModule\nGlobal Cross-Cutting]
  Audit[AuditModule\nGlobal Cross-Cutting]
  Prisma[PrismaModule\nGlobal Infrastructure]

  Catalog[CatalogModule\nPublic Read Model]
  Products[ProductsModule\nProducts Domain + Admin]
  Pricing[PricingModule\nPricing Domain + Admin]

  Admin[AdminModule]
  Onboarding[OnboardingModule]
  Recommendation[RecommendationModule]
  Checkout[CheckoutModule]
  Shipping[ShippingModule]
  Orders[OrdersModule]
  Payments[PaymentsModule]
  Subs[SubscriptionsModule]
  Users[UsersModule]
  Pets[PetsModule]
  Emails[EmailsModule]

  App --> Prisma
  App --> Auth
  App --> Audit
  App --> Catalog
  App --> Products
  App --> Pricing
  App --> Admin
  App --> Onboarding
  App --> Recommendation
  App --> Checkout
  App --> Shipping
  App --> Orders
  App --> Payments
  App --> Subs
  App --> Users
  App --> Pets
  App --> Emails

  Catalog --> Products
  Catalog --> Pricing
  Admin --> Payments

  Prisma -.shared infrastructure.-> Catalog
  Prisma -.shared infrastructure.-> Products
  Prisma -.shared infrastructure.-> Pricing
  Prisma -.shared infrastructure.-> Admin
  Prisma -.shared infrastructure.-> Onboarding
  Prisma -.shared infrastructure.-> Recommendation
  Prisma -.shared infrastructure.-> Checkout
  Prisma -.shared infrastructure.-> Shipping
  Prisma -.shared infrastructure.-> Orders
  Prisma -.shared infrastructure.-> Payments
  Prisma -.shared infrastructure.-> Subs
  Prisma -.shared infrastructure.-> Users
  Prisma -.shared infrastructure.-> Pets
  Prisma -.shared infrastructure.-> Emails

  Auth -.guards/claims.-> Catalog
  Auth -.guards/claims.-> Products
  Auth -.guards/claims.-> Pricing
  Auth -.guards/claims.-> Admin
  Auth -.guards/claims.-> Onboarding
  Auth -.guards/claims.-> Recommendation
  Auth -.guards/claims.-> Checkout
  Auth -.guards/claims.-> Shipping
  Auth -.guards/claims.-> Orders
  Auth -.guards/claims.-> Payments
  Auth -.guards/claims.-> Subs
  Auth -.guards/claims.-> Users
  Auth -.guards/claims.-> Pets
  Auth -.guards/claims.-> Emails

  Audit -.mutation audit.-> Pricing
  Audit -.mutation audit.-> Admin
  Audit -.mutation audit.-> Orders
  Audit -.mutation audit.-> Onboarding
```

Dependency rules:

- Controllers in `CatalogModule` expose only public read use cases.
- `PricingModule` owns pricing calculations and pricing admin use cases.
- `ProductsModule` owns product entities and product admin use cases.
- No direct cyclic imports are allowed between domain modules.

## Prerequisites

- Node.js 20+
- npm 10+
- MySQL 8+ (or compatible)

## Install

```bash
npm ci
```

## Environment

Set at least:

```bash
export DATABASE_URL='mysql://root:root@127.0.0.1:3306/eden_bowls'
export JWT_ACCESS_SECRET='dev-access-secret'
export JWT_REFRESH_SECRET='dev-refresh-secret'
```

## Main Commands

From repository root:

```bash
npm run api:start:dev
npm run api:build
npm run api:test
npm run e2e
```

API workspace specific commands:

```bash
npm run db:format
npm run db:generate
npm run db:migrate:dev
npm run db:migrate:deploy
npm run db:seed
```

## E2E Flow

Single command bootstrap and execution:

```bash
npm run e2e
```

What it does:

- runs API e2e bootstrap script
- ensures schema is synchronized (`prisma db push`)
- executes full flow test suite (`RUN_E2E=1`)

Default local values used by bootstrap when not provided:

- `DATABASE_URL=mysql://root:root@127.0.0.1:3307/eden_bowls`
- `JWT_ACCESS_SECRET=e2e-access-secret`
- `JWT_REFRESH_SECRET=e2e-refresh-secret`

If your MySQL runs on another host/port, override `DATABASE_URL` before running.

## CI

GitHub Actions workflow:

- file: `.github/workflows/api-e2e.yml`
- runs on push/PR affecting API/backend files
- starts MySQL service
- runs build and E2E flow (`npm run e2e`)

## Troubleshooting

- `DATABASE_URL not found`:
  - export `DATABASE_URL` before running commands that need Prisma.
- E2E cannot connect to MySQL:
  - verify host, port, user, and password in `DATABASE_URL`.
- Lockfile mismatch on `npm ci`:
  - run `npm install`, commit updated `package-lock.json`, then rerun.
