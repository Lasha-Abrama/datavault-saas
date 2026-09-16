# DataVault SaaS backend

NestJS backend foundation for DataVault with company-based tenant isolation. Subscription, billing, plan, document, and file-management business features have not been added.

## Requirements

- Node.js 24 (see `.nvmrc`; supported range is declared in `package.json`)
- npm
- A replica-set-capable MongoDB deployment; company onboarding uses a transaction
- Optional Google OAuth credentials
- Optional AWS S3 configuration

## Setup

```bash
npm ci
cp .env.example .env
npm run start:dev
```

`MONGO_URI` and a random `JWT_SECRET` of at least 32 characters are required. The application validates configuration during startup. Every supported setting is documented in `.env.example`.

## Tenant model

A company currently contains only its required name. Company names are case-insensitively unique. Every user has one required, immutable `companyId` and one role: `company_owner` or `company_member`. User emails remain globally unique so authentication resolves one identity without requiring a tenant hint.

Sign-up atomically creates a company and its owner. Company owners can create members and manage users only in their own company. Members can read, update, or delete only themselves. Owners cannot be deleted because no ownership-transfer or company-deletion workflow exists yet. Google OAuth signs in existing users and never creates a user without a company.

JWTs contain only the user id. Authentication reloads the user on every request and derives current company and role data from MongoDB. Tenant-owned queries also include `companyId`, preventing cross-company access even when a target id is known.

## Architecture

- `src/auth`: company onboarding, email/password and optional Google sign-in, and JWT issuance
- `src/companies`: company schema, current-company read/update routes, and validation
- `src/users`: tenant-scoped user creation and management
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

- `POST /auth/sign-up` — creates a company and owner; requires `companyName`, `fullName`, `email`, and `password`
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
