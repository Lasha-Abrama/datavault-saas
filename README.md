# DataVault SaaS backend

NestJS backend for DataVault with company-based tenant isolation and internal plan/subscription entitlements. External billing, document, and file-management business features have not been added.

## Requirements

- Node.js 24 (see `.nvmrc`; supported range is declared in `package.json`)
- npm
- A replica-set-capable MongoDB deployment; company onboarding uses a transaction
- An SMTP server for account-activation email
- Optional Google OAuth credentials
- Optional AWS S3 configuration

## Setup

```bash
npm ci
cp .env.example .env
npm run start:dev
```

`MONGO_URI`, a random `JWT_SECRET` of at least 32 characters, `ACCOUNT_ACTIVATION_URL`, and the required SMTP settings must be configured. `ACCOUNT_ACTIVATION_URL` should point to a frontend page that reads the token and posts it to `/auth/verify-account`. The application validates configuration during startup. Every supported setting is documented in `.env.example`.

The built-in public-auth limiter is process-local. A horizontally scaled deployment should configure a shared throttler store and a trusted proxy strategy appropriate to its hosting platform.

## Tenant model

A company stores its required name, uppercase ISO 3166-1 alpha-2 country, normalized industry, and activation timestamp. Company names are case-insensitively unique. The registration email and password belong to the owner User and are not duplicated on Company. Every user has one required, immutable `companyId` and one role: `company_owner` or `company_member`. User emails remain globally unique so authentication resolves one identity without requiring a tenant hint.

Sign-up atomically creates an inactive company, its owner, its Free subscription, and a hashed 24-hour activation token. The raw token is sent by SMTP after commit and is never stored. Password and Google sign-in are rejected until activation, and the authentication guard also reloads activation state on every protected request. Company owners can create members within their plan limit and manage users only in their own company. Members can read, update, or delete only themselves. Owners cannot be deleted or change their verified email because ownership transfer and email-change verification do not exist yet. Google OAuth signs in existing users and cannot bypass activation.

JWTs contain only the user id. Authentication reloads the user on every request and derives current company and role data from MongoDB. Tenant-owned queries also include `companyId`, preventing cross-company access even when a target id is known.

## Plans and subscriptions

The code-defined plan catalog is the source of truth and is idempotently synchronized to MongoDB on startup. Free includes 10 files per activation-anchored month and the owner only. Basic includes 100 files, up to 10 employees plus the owner, and costs $5 per employee per month. Premium includes 1,000 files, unlimited employees, costs $300 per month, and records $0.50 for each file over 1,000.

Each company has one subscription. Plan changes take effect immediately, preserve the original activation/billing anchor, and do not reset the current period's usage. A downgrade is rejected when the company already has more employees than the target plan permits. There are no payment, invoice, trial, cancellation, or provider states yet; a subscription record represents enabled internal entitlements only.

`EntitlementsService` is the internal boundary for employee and file limits. Member creation checks and creates in one transaction. Future file creation should call `recordFileUploads` in the same transaction as file metadata creation so successful uploads are counted atomically. File routes and format validation remain deferred.

## Architecture

- `src/auth`: company onboarding, email/password and optional Google sign-in, and JWT issuance
- `src/email`: provider-neutral email contract, activation template, and SMTP adapter
- `src/companies`: company schema, current-company read/update routes, and validation
- `src/users`: tenant-scoped user creation and management
- `src/plans`: immutable plan definitions, persisted catalog schema, and public read route
- `src/subscriptions`: company subscription state, calendar billing periods, and centralized entitlement enforcement
- `src/common`: current-user context plus extensible role metadata and guard
- `src/aws-s3`: reusable optional storage infrastructure with no business-facing file routes
- `src/config`: startup validation and shared HTTP configuration

## Commands

```bash
npm run build
npm run lint
npm test -- --runInBand
npm run test:e2e -- --runInBand
npm run start:prod
```

## Current API

- `POST /auth/sign-up` — creates a pending company, optional owner profile, Free subscription, and activation token; requires `companyName`, `email`, `password`, `country`, and `industry`
- `POST /auth/verify-account` — consumes a single-use activation token
- `POST /auth/resend-verification` — generic, cooldown-protected resend response
- `POST /auth/sign-in`
- `GET /auth/current-user` — authenticated
- `GET /auth/google` and `GET /auth/google/callback` — optional existing-user sign-in
- `GET /companies/current` — any company user
- `PATCH /companies/current` — company owner
- `POST /users` — company owner creates a member in their company
- `GET /users` — company owner lists users in their company
- `GET /users/:id` — self or company owner, within the company
- `PATCH /users/:id` — self or company owner, within the company
- `DELETE /users/:id` — member self-delete or owner deletes a member
- `GET /plans` — public plan catalog
- `GET /subscriptions/current` — any authenticated company user
- `PATCH /subscriptions/current` — company owner changes the company plan
