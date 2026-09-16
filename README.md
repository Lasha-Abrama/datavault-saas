# DataVault SaaS backend

NestJS backend foundation for DataVault. This repository currently contains reusable authentication, user-management, MongoDB, and S3 infrastructure. Tenant, company, subscription, billing, and domain file-management features have not been added yet.

## Requirements

- Node.js 24 (see `.nvmrc`; supported range is declared in `package.json`)
- npm
- MongoDB
- Optional Google OAuth credentials
- Optional AWS S3 configuration

## Setup

```bash
npm ci
cp .env.example .env
npm run start:dev
```

`MONGO_URI` and a random `JWT_SECRET` of at least 32 characters are required. The application validates configuration during startup. Every supported setting, including the rules for enabling Google OAuth and S3, is documented in `.env.example`.

## Architecture

- `src/auth`: email/password and optional Google OAuth sign-in, JWT issuance, and current-user lookup
- `src/users`: Mongoose user schema, protected CRUD routes, pagination, and self/admin authorization
- `src/guards` and `src/decorators`: bearer-token authentication, admin authorization, and typed request metadata
- `src/aws-s3`: reusable optional S3 upload/delete and CloudFront URL helper; no business-facing file routes
- `src/config`: startup environment validation and shared HTTP application configuration

Global request validation transforms DTO values, strips no fields silently, and rejects unknown properties. CORS is disabled unless `CORS_ORIGIN` is configured. JWTs use HS256 and expire after one hour.

## Commands

```bash
npm run build
npm run lint
npm test -- --runInBand
npm run test:e2e -- --runInBand
npm run start:prod
```

Vercel detects `src/main.ts` as the NestJS entry point; `vercel.json` contains only its schema declaration.

## Current API

- `POST /auth/sign-up`
- `POST /auth/sign-in`
- `GET /auth/current-user` (authenticated)
- `GET /auth/google` (available when Google OAuth is configured)
- `GET /auth/google/callback`
- `GET /users` (admin)
- `GET /users/:id` (self or admin)
- `PATCH /users/:id` (self or admin)
- `DELETE /users/:id` (self or admin)
