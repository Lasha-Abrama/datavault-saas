# Architecture

Reviewed against repository code on 2026-10-11. [Documentation index](README.md).

## Backend modules

- `src/auth`: company onboarding, email/password and optional Google sign-in, and JWT issuance
- `src/email`: provider-neutral email contract, activation/invitation templates, and SMTP/Resend adapters
- `src/invitations`: tenant-bound employee invitation lifecycle and acceptance
- `src/companies`: company schema, current-company read/update routes, and validation
- `src/users`: tenant-scoped management of existing users
- `src/plans`: immutable plan definitions, persisted catalog schema, and public read route
- `src/subscriptions`: company subscription state, calendar billing periods, and centralized entitlement enforcement
- `src/subscriptions/billing.service.ts`: authoritative current-period billing estimate from plan, employees, and upload accounting
- `src/common`: current-user context plus extensible role metadata and guard
- `src/files`: tenant-owned metadata, multipart validation, upload compensation, private downloads, and deletion policy
- `src/aws-s3`: provider-neutral object-storage contract and private S3 adapter
- `src/config`: startup validation and shared HTTP configuration
- `src/health`: public liveness/readiness probes and MongoDB transaction-capability startup check
- `src/statistics`: bonus tenant dashboard composed from existing authoritative domain data
- `src/ai`: tenant-owned conversations, OpenRouter/Gemini adapters, safe usage accounting, throttling, and read-only DataVault tool loop

## Bonus: company statistics dashboard

`GET /statistics/current` is an additional read-only dashboard endpoint beyond the original assignment requirements. Activated owners and members receive statistics only for the company derived from their JWT. The response combines accepted employees, live pending invitations, current file-metadata counts by visibility, activation-anchored upload usage, current plan capacity, Premium overage, and the existing integer-cent billing calculation. It accepts no calculation or tenant inputs and sends `Cache-Control: private, no-store`.

Currently stored files and current-period successful uploads are separate values: deleting a file removes its metadata from the stored count but does not reduce historical monthly upload usage. `remainingUploads` counts available stored-file slots for Free and Basic, and is `null` for Premium, where uploads beyond the included 1,000 are billed as overage. Employee limits use the same convention: `null` means unlimited.

## Request and persistence boundaries

Nest root `AppModule` loads validated configuration, Mongoose models and feature
modules. Controllers validate transport input and establish guards; services
apply company/user scopes, authorization, entitlements, and transactions. The
storage adapter handles S3 outside retryable MongoDB transactions. Transactions
and required indexes are startup prerequisites, not optional optimizations.

`src/payments/` contains Stripe Test Mode adapters, webhook verification, durable
operations/outbox and polling reconciliation. It needs a long-lived API process.
`src/admin/` has separate identities, signing purpose, guards, metadata projections,
access requests and append-only audits. `src/ai/` adds tenant/user-owned history,
read-only domain tools, provider routing and content-free usage accounting.

## Frontend

`frontend/app/` contains Next.js App Router pages, layouts, and the same-origin
backend gateway. `components/` owns auth, workspace files, platform Files,
billing and shared assistant UI; `lib/` contains the API client, session/auth
context, hooks and upload safety helpers. `tests/` uses Playwright for browsers
and Node's test runner for upload helpers. The application uses React client
components with the existing CSS and Lucide icons; no additional UI framework
is required.

Browser API requests go through the fixed, allowlisted `/backend` gateway.
It forwards Bearer authorization, streams request/response bodies, rejects
upstream redirects, and does not forward cookies or store sessions. Tenant
and platform sessions use separate sessionStorage keys. Google begins with
full browser navigation directly to the API so its state cookie remains there;
one-use exchange codes return to the frontend and are removed from browser history.
Session storage is reachable by client JavaScript, so XSS prevention and avoiding
secrets in rendered content remain necessary.

`dist/` and `frontend/.next/` are generated. Backend/frontend have separate
package manifests, lockfiles, installs, and builds. There is no monorepo root
frontend build command or shared runtime environment file.

## Source map

Read [security](security.md), [billing](billing.md), [AI](ai.md), [admin](admin.md),
[API](api.md), and [environment](environment.md) before editing those boundaries.
The [roadmap](stabilization-roadmap.md) records completed stabilization work and
unverified operational risks. History is not a current live-integration claim.
