# DataVault SaaS backend

NestJS backend for DataVault with company-based tenant isolation, internal plan/subscription entitlements, email onboarding, and private CSV/XLS/XLSX file storage. An optional Stripe Test Mode integration uses hosted card setup and company subscriptions; assignment mode remains available without Stripe.

## Local setup

Use Node.js 24 (see `.nvmrc`) and npm:

```bash
npm ci
cp .env.example .env
npm run start:dev
```

`MONGO_URI`, a random `JWT_SECRET` of at least 32 characters, `ACCOUNT_ACTIVATION_URL`, `EMPLOYEE_INVITATION_URL`, and the required SMTP settings must be configured. The two application URLs should point to frontend pages that read the token and call `/auth/verify-account` or `/invitations/accept`, respectively. The application validates configuration during startup and requires HTTPS for non-local application URLs. Every supported setting is documented in `.env.example`.

## Production configuration

Set configuration in the deployment environment or secret manager; never bake `.env` files into an image. The repository ignores all `.env*` files except the placeholder-only `.env.example`.

### MongoDB

| Variable                            | Required | Purpose                                                                                                                         |
| ----------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `MONGO_URI`                         | Yes      | MongoDB Atlas or another replica-set/sharded-cluster URI. Include the database name and TLS options required by the deployment. |
| `MONGO_SERVER_SELECTION_TIMEOUT_MS` | No       | Driver server-selection timeout; defaults to 10,000 ms.                                                                         |
| `MONGO_MAX_POOL_SIZE`               | No       | Per-process connection-pool maximum; defaults to 20. Size the aggregate across all replicas.                                    |
| `MONGO_RETRY_ATTEMPTS`              | No       | Nest startup connection attempts; defaults to 5.                                                                                |
| `MONGO_RETRY_DELAY_MS`              | No       | Delay between startup attempts; defaults to 3,000 ms.                                                                           |

Transactions are mandatory. Company registration, invitation acceptance, employee-seat reservation, plan changes, and upload quota/metadata accounting rely on multi-document transactions. A standalone MongoDB is unsupported. Startup executes MongoDB's `hello` command and refuses to serve traffic unless logical sessions and either a replica set or sharded cluster are present. Initial connection failures also stop startup after the configured retries; operations never fall back to non-transactional writes.

The fresh application keeps Mongoose automatic index creation enabled so required unique, partial, TTL, and tenant query indexes are created from the schemas. The database identity therefore needs normal application read/write and index-creation permissions. Review index creation before adding this application to a populated legacy database; no migration is required for a fresh deployment.

### JWT and application

| Variable                  | Required            | Purpose                                                                                                               |
| ------------------------- | ------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `JWT_SECRET`              | Yes                 | Random signing secret of at least 32 characters. Store only in a secret manager.                                      |
| `NODE_ENV`                | Production          | Set to `production`; accepted values are `development`, `test`, and `production`.                                     |
| `PORT`                    | No                  | Listening port supplied by the platform; defaults to 3000. The process binds `0.0.0.0`.                               |
| `TRUST_PROXY_HOPS`        | No                  | Exact number of trusted reverse-proxy hops; defaults to 0. Configure only after confirming the provider network path. |
| `CORS_ORIGIN`             | Browser deployments | Comma-separated explicit frontend HTTPS origins. Blank disables CORS; wildcards and paths are rejected.               |
| `ACCOUNT_ACTIVATION_URL`  | Yes                 | HTTPS frontend URL that consumes the company activation token.                                                        |
| `EMPLOYEE_INVITATION_URL` | Yes                 | HTTPS frontend URL that consumes the employee invitation token.                                                       |

JWTs use HS256 with a one-hour lifetime and an explicit algorithm allowlist. Helmet supplies standard security headers. DTO validation strips no unknown values silently: unknown fields are rejected. CORS does not allow credentials and never defaults to a wildcard. Public sign-in, registration, verification, resend, and invitation acceptance routes are rate-limited in memory. A horizontally scaled deployment should replace that limiter store with a shared implementation and set `TRUST_PROXY_HOPS` to the verified proxy chain.

### Email/SMTP

| Variable                     | Required           | Purpose                                                            |
| ---------------------------- | ------------------ | ------------------------------------------------------------------ |
| `SMTP_HOST`                  | Yes                | SMTP hostname or IP address.                                       |
| `SMTP_PORT`                  | No                 | Defaults to 587, or 465 when implicit TLS is enabled.              |
| `SMTP_SECURE`                | No                 | `true` for implicit TLS, normally port 465; defaults to `false`.   |
| `SMTP_REQUIRE_TLS`           | No                 | Requires STARTTLS when not using implicit TLS; defaults to `true`. |
| `SMTP_FROM`                  | Yes                | Verified sender email address.                                     |
| `SMTP_USER`, `SMTP_PASSWORD` | Provider-dependent | Authentication pair; configure both or neither.                    |

SMTP connection, greeting, and socket timeouts are bounded. Nodemailer file and URL access are disabled. Activation and invitation URLs must use HTTPS outside localhost. Before launch, verify sender-domain authorization, outbound network access, link routing, and delivery with the real provider.

### AWS S3 and files

| Variable                                     | Required                            | Purpose                                                                              |
| -------------------------------------------- | ----------------------------------- | ------------------------------------------------------------------------------------ |
| `AWS_BUCKET_NAME`                            | File operations                     | Private S3 bucket.                                                                   |
| `AWS_REGION`                                 | File operations                     | Region containing the bucket.                                                        |
| `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` | No                                  | Explicit credential pair. Prefer the platform IAM role/default AWS credential chain. |
| `AWS_SESSION_TOKEN`                          | Temporary explicit credentials only | Session token; requires the explicit credential pair.                                |
| `FILE_MAX_SIZE_BYTES`                        | No                                  | Buffered multipart limit; defaults to 10 MiB and is capped at 100 MiB.               |

Keep S3 Block Public Access enabled and enable bucket default encryption. The runtime principal needs only `s3:PutObject`, `s3:GetObject`, and `s3:DeleteObject` on `arn:aws:s3:::BUCKET/companies/*`; the application does not list the bucket, set public ACLs, or use permanent public URLs. Align provider/proxy body limits and memory with `FILE_MAX_SIZE_BYTES`.

### Optional Google OAuth

| Variable                                   | Required together | Purpose                                                           |
| ------------------------------------------ | ----------------- | ----------------------------------------------------------------- |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Yes, when enabled | OAuth client credentials.                                         |
| `GOOGLE_CALLBACK_URL`                      | Yes, when enabled | HTTPS backend `/auth/google/callback` URL registered with Google. |
| `FRONT_URI`                                | Yes, when enabled | HTTPS frontend origin receiving the completed sign-in redirect.   |

Leaving all four Google variables blank disables Google OAuth.

## Health and process lifecycle

- `GET /health/live` reports process liveness without contacting dependencies.
- `GET /health/ready` pings MongoDB and returns HTTP 503 with a sanitized response while MongoDB is unavailable.
- Nest shutdown hooks close managed resources on termination signals.
- Health routes reveal no credentials, hosts, stack traces, or application data.

Application logging does not log Stripe secrets or full provider errors/webhook payloads, request bodies, passwords, JWTs, raw verification/invitation tokens, SMTP credentials, AWS credentials, or uploaded file buffers. Infrastructure adapters emit only generic failure messages; client-facing dependency failures are sanitized.

## Production build and start

For a direct Node deployment:

```bash
npm ci
npm run build
npm run start:prod
```

`start:prod` executes `node dist/main`. The included multi-stage Dockerfile installs from the lockfile, builds the application, prunes development dependencies, and runs as the unprivileged `node` user:

```bash
docker build -t datavault-saas .
docker run --env-file .env -p 3000:3000 datavault-saas
```

The image contains no `.env`, source tests, Git metadata, or development dependencies.

Deployment checklist:

1. Provision an Atlas/replica-set database and allow the runtime network and database identity.
2. Supply secrets and configuration through the provider's secret/environment facility.
3. Configure explicit HTTPS CORS and activation/invitation frontend URLs.
4. Attach a least-privilege S3 role and verify private upload, download, deletion, and failed-upload cleanup.
5. Verify SMTP TLS, sender identity, activation delivery, and invitation delivery.
6. Configure the platform health checks: liveness for process restart decisions and readiness for traffic routing.
7. Confirm proxy hops, request-size limits, runtime memory, Mongo pool totals, and graceful termination timeouts.
8. Run `npm ci`, build, tests, and `npm audit` from the exact revision being deployed.

## Tenant model

A company stores its required name, uppercase ISO 3166-1 alpha-2 country, normalized industry, and activation timestamp. Company names are case-insensitively unique. The registration email and password belong to the owner User and are not duplicated on Company. Every user has one required, immutable `companyId` and one role: `company_owner` or `company_member`. User emails remain globally unique so authentication resolves one identity without requiring a tenant hint.

Sign-up atomically creates an inactive company, its owner, its Free subscription, and a hashed 24-hour activation token. The raw token is sent by SMTP after commit and is never stored. Password and Google sign-in are rejected until activation, and the authentication guard also reloads activation state on every protected request. Activated company owners invite employees by email; the 72-hour, single-use invitation is the only path that creates a `company_member`. Acceptance derives the company, email, and role from the stored invitation. Members can read and update only themselves. Only owners may list or delete employees, manage invitations, or invite employees. Owners cannot delete themselves. User email, company, and role are immutable through profile updates because email-change verification and ownership transfer do not exist. Google OAuth signs in existing users and cannot bypass activation.

Authenticated owners and employees change their own password through `PATCH /users/me/password`. The endpoint verifies the existing password, requires a different 8–72 character replacement, hashes it with bcrypt, and uses the previous hash as an atomic update condition. Generic user profile updates accept only `fullName`; password and identity fields are rejected by request validation.

JWTs contain only the user id. Authentication reloads the user on every request and derives current company and role data from MongoDB. Tenant-owned queries also include `companyId`, preventing cross-company access even when a target id is known.

## Plans and subscriptions

The code-defined plan catalog is the source of truth and is idempotently synchronized to MongoDB on startup. Free includes 10 files per activation-anchored month and the owner only. Basic includes 100 files, up to 10 employees plus the owner, and costs $5 per employee per month. Premium includes 1,000 files, unlimited employees, costs $300 per month, and records $0.50 for each file over 1,000.

Each company has one subscription. With `STRIPE_ENABLED=false`, plan changes take effect immediately, preserve the original activation/billing anchor, and do not reset the current period's usage. A downgrade is rejected when accepted employees plus live pending invitations exceed the target plan. Assignment mode requires no payments or provider states. Stripe-managed subscriptions follow the additional lifecycle below; disabling Stripe never silently bypasses their payment gate.

`GET /subscriptions/current/billing` returns an internal current-period estimate in integer USD cents. The response derives every value server-side from the authenticated company: the code-defined current plan supplies its base price, employee unit price, included upload allowance, and Premium overage unit price; the user collection supplies the current accepted employee count (the owner and pending invitations are not billed); and the current `SubscriptionPeriod` supplies successful uploads and overage already recorded when Premium uploads succeeded. The total is `baseAmountCents + employeeChargeCents + overageChargeCents`.

The estimate uses the current plan and current employee count because the assignment defines neither proration nor historical employee/plan charging rules. It is always labeled `current_plan_estimate_with_recorded_overage`, includes `planChangedInCurrentPeriod`, and is not an invoice or payment state. An immediate plan change retains the activation-day anchor and accumulated upload usage. Recorded Premium overage remains in the period after a downgrade, while the new plan controls future entitlements. A downgrade may therefore leave usage above the new file allowance; later uploads stay blocked until the next activation-anchored period. Period ends are exclusive, and day-29/30/31 anchors clamp to the last UTC day of short months before returning to the original day when possible.

`EntitlementsService` is the internal boundary for employee and file limits. Invitation creation reserves a seat, and acceptance converts that reservation into an employee in a transaction. Free permits no employees, Basic permits 10 employees plus the owner, and Premium has no employee limit. Successful file uploads record metadata and monthly usage in the same transaction; deletion never refunds an upload count.

## Bonus: company statistics dashboard

`GET /statistics/current` is an additional read-only dashboard endpoint beyond the original assignment requirements. Activated owners and members receive statistics only for the company derived from their JWT. The response combines accepted employees, live pending invitations, current file-metadata counts by visibility, activation-anchored upload usage, current plan capacity, Premium overage, and the existing integer-cent billing calculation. It accepts no calculation or tenant inputs and sends `Cache-Control: private, no-store`.

Currently stored files and current-period successful uploads are separate values: deleting a file removes its metadata from the stored count but does not reduce historical monthly upload usage. `remainingUploads` is finite for Free and Basic and `null` for Premium, where uploads beyond the included 1,000 are billed as overage. Employee limits use the same convention: `null` means unlimited.

## Private company files

Configure `AWS_BUCKET_NAME` and `AWS_REGION` to enable file operations. Use a private bucket with S3 Block Public Access enabled and an IAM role allowing only the required `PutObject`, `GetObject`, and `DeleteObject` operations. Explicit access-key credentials are optional; the SDK's default credential chain supports deployment IAM roles. Unconfigured storage returns HTTP 503. The previous public CloudFront URL helper has been removed.

Uploads use a multipart `file` field, optional `visibility` (`company_wide` by default or `restricted`), and optional `restrictedUserIds`. A single employee id may be sent directly; multiple ids use one JSON-array field. Other form fields are rejected. Ownership, uploader, and `companies/<companyId>/files/<random UUID>.<extension>` keys are generated by the server. MongoDB stores metadata only. `FILE_MAX_SIZE_BYTES` defaults to 10 MiB and is capped at 100 MiB because uploads are buffered in memory. Align reverse-proxy request limits and deployment capacity with this value.

Validation requires a supported extension, compatible declared MIME type, and content structure. CSV must be non-empty UTF-8 text without binary control characters; common CSV/text MIME aliases are supported. XLS must have an OLE compound header and workbook stream marker. XLSX must have a valid ZIP central directory containing `[Content_Types].xml` and `xl/workbook.xml`. This validates format structure without importing spreadsheet-processing logic.

Every file is either company-wide or restricted. Activated members see company-wide files plus restricted files that explicitly contain their user id; uploaders retain access to and control of their own files, and the company owner sees and manages every tenant file. Restricted ids are validated as unique, existing `company_member` users in the authenticated company. Company-wide files have an empty restricted list, while restricted files require at least one selected employee. Existing records without a visibility field are treated as company-wide for backward compatibility.

The uploader or company owner may replace a file's visibility and complete restricted list. This updates MongoDB authorization metadata only; it never copies the object or changes a private S3 ACL. Cross-company and unauthorized metadata/download identifiers return HTTP 404. A same-company non-uploader receives HTTP 403 when attempting permission changes. Downloads stream through the authenticated backend with attachment headers, MIME sniffing disabled, and private/no-store cache policy. No public or presigned S3 URL is exposed, so there is no reusable download-link expiration to manage.

Employee deletion uses lazy permission cleanup. A deleted user's id may remain in historical restricted lists, but authentication reloads users on every request, so the deleted identity immediately loses access and the stale id cannot authorize anyone else. Owners retain access and can replace the permission list. This avoids coupling employee deletion to a potentially large file update and keeps deletion independent of S3.

An advisory quota check avoids unnecessary S3 uploads when the company is already at its limit. After S3 succeeds, an authoritative quota update acquires the existing subscription transaction lock and commits with metadata using majority write concern. Concurrent uploads cannot exceed Free/Basic limits, and Premium overage is recorded in cents. A failed transaction triggers S3 cleanup. If MongoDB reports an uncertain commit acknowledgement, a primary/majority metadata read first confirms whether the transaction committed; a confirmed commit is returned successfully, and an unavailable confirmation leaves the private object intact rather than risking deletion of a committed file. No external S3 call occurs inside a retryable MongoDB transaction. A process crash between S3 upload and database commit, or a failed compensating delete, can leave a private orphan object; reconciliation remains an operational follow-up.

Deletion removes the S3 object first, then its tenant-scoped metadata. S3 failure preserves metadata. If the later database deletion fails, the metadata remains retryable because S3 object deletion is idempotent. Monthly usage is never decremented.

## Architecture

- `src/auth`: company onboarding, email/password and optional Google sign-in, and JWT issuance
- `src/email`: provider-neutral email contract, activation/invitation templates, and SMTP adapter
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

## Commands

```bash
npm run build
npm run lint
npm test -- --runInBand
npm run test:e2e -- --runInBand
npm run start:prod
```

## Current API

- `GET /health/live` — process liveness
- `GET /health/ready` — MongoDB readiness
- `POST /auth/sign-up` — creates a pending company, optional owner profile, Free subscription, and activation token; requires `companyName`, `email`, `password`, `country`, and `industry`
- `POST /auth/verify-account` — consumes a single-use activation token
- `POST /auth/resend-verification` — generic, cooldown-protected resend response
- `POST /auth/sign-in`
- `GET /auth/current-user` — authenticated
- `GET /auth/google` and `GET /auth/google/callback` — optional existing-user sign-in
- `GET /companies/current` — any company user
- `PATCH /companies/current` — company owner
- `POST /invitations` — activated company owner invites an employee; accepts only an email
- `GET /invitations` — company owner lists their company's live pending invitations
- `POST /invitations/:id/resend` — company owner rotates and resends a live invitation after the cooldown
- `DELETE /invitations/:id` — company owner revokes a pending invitation
- `POST /invitations/accept` — public employee acceptance with token, full name, and password
- `GET /users` — company owner lists users in their company
- `GET /users/:id` — self or company owner, within the company
- `PATCH /users/me/password` — authenticated self-service password change requiring `currentPassword` and `newPassword`
- `PATCH /users/:id` — self or company owner, within the company; accepts only `fullName`
- `DELETE /users/:id` — company owner deletes a member; owner self-deletion is rejected
- `GET /plans` — public plan catalog
- `GET /subscriptions/current` — any authenticated company user
- `GET /subscriptions/current/billing` — owner/member internal current-period estimate; no calculation inputs
- `PATCH /subscriptions/current` — company owner changes the company plan
- `POST /files` — authenticated multipart upload with `file`, optional `visibility`, and optional `restrictedUserIds`
- `GET /files` — company file list using `page` and `take`, capped at 30 per page
- `GET /files/:id` — company file metadata
- `GET /files/:id/download` — authenticated private attachment stream
- `PATCH /files/:id/permissions` — uploader or company owner replaces visibility and restricted employees
- `DELETE /files/:id` — uploader or company owner deletes a company file
- `GET /statistics/current` — activated owner/member tenant dashboard; accepts no client-supplied statistics

## Optional Stripe Test Mode payments

This integration is additional functionality. `STRIPE_ENABLED=false` is the default and preserves the original assignment flow and internal billing calculations. It never uses live keys or live catalog objects. SDK `stripe@22.6.2` and API `2026-08-26.dahlia` are pinned. No card number, CVC, payment-method detail, secret, or complete webhook payload is stored in MongoDB.

### Authority and catalog setup

DataVault owns tenant identity, owner/member permissions, activation, accepted employees, pending-seat reservations, successful upload counts, product limits, and the immutable original subscription anniversary. Stripe owns card setup, collection, its subscription lifecycle, and real invoice/payment results. `GET /subscriptions/current/billing` and dashboard billing remain **DataVault current-plan estimates**, not Stripe invoices or amounts collected. `GET /payments/current` returns actual Stripe invoice amounts separately, in integer USD cents.

Create the following **Test Mode** catalog in Stripe before enabling the integration. Do not create a Free Stripe subscription.

| Mapping                   | Stripe configuration                                                                            | DataVault rule                                                                                             |
| ------------------------- | ----------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `STRIPE_BASIC_PRICE_ID`   | USD 500 cents, monthly, per-unit, licensed recurring Price                                      | Quantity = accepted `company_member` users, 0–10. Owner and pending invitations are excluded from charges. |
| `STRIPE_PREMIUM_PRICE_ID` | USD 30000 cents, monthly, per-unit, licensed recurring Price                                    | Quantity = 1. Unlimited employees.                                                                         |
| `STRIPE_OVERAGE_PRICE_ID` | USD 50 cents, monthly, per-unit, metered recurring Price linked to the configured billing meter | Only incremental successful Premium uploads beyond DataVault's 1,000-upload period allowance are reported. |

Create an active billing meter with **sum** aggregation, the event name in `STRIPE_OVERAGE_EVENT_NAME`, customer mapping payload key `stripe_customer_id`, and numeric value key `value`. Set `STRIPE_OVERAGE_METER_ID` to that meter. Do not configure an additional free tier on the meter: DataVault already excludes included uploads. Leave tax, discounts, trials, usage thresholds, and invoice credits unconfigured for this product; these are outside the implemented policy. The server checks all three prices and meter settings before Checkout and paid plan changes, including rejection of quantity transforms that would change per-unit billing.

Create a Test Mode Customer Portal configuration. Enable payment-method updates and invoice history/payment access. **Disable subscription updates and cancellation** in the portal: those must go through DataVault's seat/upload conflict checks. The server rejects a configuration with those controls enabled. Do not modify DataVault subscriptions, catalog quantities, schedules, or billing anchors directly through Stripe Dashboard; such changes are detected/reconciled rather than accepted as client product rules.

| Variable                                                                                | Required when enabled | Purpose                                                                                                                                                                                    |
| --------------------------------------------------------------------------------------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `STRIPE_ENABLED`                                                                        | No                    | Opt-in boolean, defaults to `false`.                                                                                                                                                       |
| `STRIPE_SECRET_KEY`                                                                     | Yes                   | Test secret key (`sk_test_…`), backend/secret manager only.                                                                                                                                |
| `STRIPE_WEBHOOK_SECRET`                                                                 | Yes                   | Endpoint signing secret (`whsec_…`); local CLI and deployed endpoint secrets differ.                                                                                                       |
| `STRIPE_BASIC_PRICE_ID`, `STRIPE_PREMIUM_PRICE_ID`, `STRIPE_OVERAGE_PRICE_ID`           | Yes                   | Three distinct Test Mode Prices with the exact configurations above.                                                                                                                       |
| `STRIPE_OVERAGE_METER_ID`, `STRIPE_OVERAGE_EVENT_NAME`                                  | Yes                   | Sum meter and its event name.                                                                                                                                                              |
| `STRIPE_PORTAL_CONFIGURATION_ID`                                                        | Yes                   | Test Mode portal configuration without plan/cancel controls.                                                                                                                               |
| `STRIPE_CHECKOUT_SUCCESS_URL`, `STRIPE_CHECKOUT_CANCEL_URL`, `STRIPE_PORTAL_RETURN_URL` | Yes                   | Server-configured frontend destinations. HTTPS outside localhost; HTTPS everywhere in production. No URLs are accepted from the client.                                                    |
| `STRIPE_SYNC_INTERVAL_MS`                                                               | No                    | Mongo-backed reconciliation polling, defaults to 30 seconds (10–300 seconds). Run at least one long-lived Nest process; serverless-only request execution cannot run this worker reliably. |

These settings are placeholders in `.env.example`; configure actual values privately. Test Mode keys/prices/meter/portal must belong to the same Stripe account/environment.

### API and hosted setup flow

All six authenticated endpoints require an activated company and `company_owner`; members cannot inspect or control payment-provider data. No endpoint accepts tenant IDs, quantities, prices, amounts, usage, or redirect URLs.

| Endpoint                   | Input                                              | Result                                                                                                                                                                                                                                                             |
| -------------------------- | -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `POST /payments/checkout`  | `{ "planCode": "basic" }` or `premium`             | Hosted Checkout setup URL; `mode: "setup"`, `paymentCollected: false`.                                                                                                                                                                                             |
| `POST /payments/portal`    | Empty body                                         | Short-lived hosted portal URL for the authenticated company.                                                                                                                                                                                                       |
| `GET /payments/current`    | No inputs                                          | Test Mode, local plan/access, Stripe status, queued target/date, billing period, sync issue/time/pending usage, and the latest 10 tenant Stripe invoices (IDs, status, currency, amounts in cents, hosted URL, creation date). `Cache-Control: private, no-store`. |
| `POST /payments/plan`      | `{ "planCode": "basic" }` (Free, Basic or Premium) | Validated immediate upgrade or queued downgrade. Choosing the current plan undoes a queued downgrade/cancellation.                                                                                                                                                 |
| `POST /payments/cancel`    | Empty body                                         | Validated downgrade to Free at the next anniversary.                                                                                                                                                                                                               |
| `POST /payments/reconcile` | Empty body                                         | Owner-requested recovery/synchronization followed by current payment information; limited to 5 requests/minute.                                                                                                                                                    |
| `POST /payments/webhook`   | Stripe-signed raw JSON                             | Public signature-verified webhook, independent of JWT/CORS browser authorization.                                                                                                                                                                                  |

When enabled, the existing owner-only `PATCH /subscriptions/current` delegates to the same payment plan service; it cannot grant paid access directly. An unmanaged paid plan from assignment mode must complete Checkout before new uploads/onboarding when payments are enabled. Existing data remains readable and deletable.

Checkout uses **setup mode**, not a payment assertion. A signed completion event or reconciliation retrieves the canonical completed Checkout and succeeded SetupIntent, verifies the stored company/customer/session/operation mapping, and creates the recurring subscription server-side using the saved card. A redirect or frontend claim never activates anything. A company Stripe Customer is created lazily using a stable tenant idempotency key. Basic supports zero accepted employees and hence a zero-quantity item. There is no invented trial period.

### Anniversary, charges and plan changes

The original UTC activation day/hour/minute/second becomes Stripe's `billing_cycle_anchor_config`; day 29/30/31 clamps in short months and returns to the original day. Stripe has second precision; DataVault retains its original millisecond precision and quota periods. Both configuration and returned subscription item period ends are validated against DataVault's anniversary. No action resets accumulated uploads or the anniversary.

**Proration is disabled everywhere.** Card setup does not charge. The initial partial period's recurring Basic/Premium fee is deferred/waived by Stripe's `proration_behavior: none`, with the first full recurring fee collected at the next anniversary. There is no fake paid state, backdated invoice, activation charge, or fractional-month formula. Premium overage still comes only from recorded successful uploads. An immediate Basic→Premium upgrade changes entitlements after a trusted Stripe update; the changed recurring price applies at the next anniversary. Previously collected invoices are not rewritten/refunded. This explicit policy differs from the current-plan estimate during partial periods.

Premium→Basic uses a Stripe subscription schedule at the current period end, preserving the original anchor with no phase proration. Basic/Premium→Free cancels at that same period end. Downgrades/cancellations are rejected if accepted employees plus live pending invitations exceed the target or current-period uploads exceed a capped target. While a lower plan is queued, onboarding/uploads enforce the stricter current/target capacity, preventing concurrent requests from invalidating the downgrade. The owner can delete employees, revoke invitations or wait for the next period before retrying an illegal downgrade. Conflicting queued targets are rejected; choosing the current plan first removes the pending request. An unconfirmed downgrade/cancellation that misses its anniversary is flagged for reconciliation instead of silently moving to a later date; choosing the current plan resets that request so the owner can explicitly choose a new date. External cancellation with a Free conflict suspends mutations and preserves the prior plan/data until Free can fit.

Local access states are `unmanaged` (assignment mode), `deferred` (Stripe-confirmed active subscription before collection/during a draft), `active` (active with a paid latest invoice, or a valid post-cancellation Free company), and `suspended` (incomplete, past-due, unpaid, paused, canceled with conflicts, or an open/action-required/uncollectible invoice). Deferred never means paid. Recovery from canonical active/paid Stripe state restores access. Suspended companies retain authentication, reads/downloads/deletions and owner remediation, but cannot upload or onboard employees. A `reconciliation_required` issue blocks new uploads/onboarding until resolved. Managed payment state older than 24 hours fails closed for these mutations; disabling the integration also fails closed for managed companies.

### Employees, overage, reconciliation and retries

Basic quantities come only from accepted tenant employees. Acceptance and, in Stripe mode, deletion share the subscription transaction lock with plan changes and authoritative seat snapshots. The durable reconciliation worker converges the licensed item without proration; invitation creation reserves capacity but does not increase Stripe quantity. At renewal, invoice reconciliation saves one accepted-employee snapshot in Stripe invoice metadata and adjusts the draft Basic line to it before collection. Changes after that snapshot affect the next renewal; the DataVault estimate always uses the live count.

Usage recorded before opting into Stripe is not back-charged or backfilled. Existing counters/estimates remain intact; new managed successful uploads produce the durable reporting records.

A successful Premium overage upload creates a unique `StripeUsage` outbox row **inside the same MongoDB transaction** as file metadata and period usage. Failed storage/database work cannot enqueue charges; deletion never removes usage or outbox rows. Rows contain company/customer/subscription identifiers, integer quantity, period, reporting timestamp, stable event identifier, delivery state and retry timestamps. The worker submits sum-meter events using that identifier and the same Stripe idempotency key, then marks them submitted. It never reports client counts or all 1,000 included uploads.

Stripe meter summaries are minute-aligned and asynchronous. Reporting timestamps move by less than a minute at interval boundaries so each event belongs to the correct company/Stripe meter window, including immediately after Premium activation. DataVault timestamps/quota boundaries are unchanged. Draft invoices are held with `auto_advance: false` until local pending usage is delivered and the Stripe meter summary equals the authoritative outbox quantity; a verified matching summary supplies the draft overage line quantity. Only then is automatic collection restored. Mismatches are exposed as `reconciliation_required`, never silently replaced with an invented total. Unrelated/manual customer invoices are not modified. An invoice already finalized during a prolonged outage cannot be rewritten by this integration; inspect it manually against the outbox before collecting/correcting it.

Supported webhook events: `checkout.session.completed`, `checkout.session.expired`, `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.created`, `invoice.finalized`, `invoice.paid`, `invoice.payment_failed`, `invoice.payment_action_required`, and `invoice.marked_uncollectible`. Other events are acknowledged and ignored. Live events and invalid/missing signatures are rejected. Webhooks always retrieve current canonical Stripe state instead of applying possibly stale event snapshots. A durable unique `StripeEvent.eventId` ledger is committed with local state in a MongoDB transaction; duplicate/replayed events cannot double-apply it. Ledger entries deliberately have no TTL. Stripe event/outbox model initialization awaits their required indexes before serving traffic; unique partial customer/subscription/Checkout indexes protect company mappings. Unknown external objects are ignored; events racing a known Checkout subscription creation are retried. Operational failures return sanitized HTTP 503 so Stripe retries.

Per-company Mongo leases serialize Stripe operations across process replicas; subscription transaction revision locks serialize local seats/usage/plan constraints. Stripe calls occur outside Mongo transactions and use stable keys and persisted operation snapshots. The worker claims due tenants in bounded batches and retries failures without starving other companies. It resumes from persisted state after restart; manual owner reconciliation uses the same path. Deploy a long-lived process and allow time for graceful shutdown.

Stripe's meter identifier and general idempotency windows are finite. An ambiguous operation older than **23 hours**, or usage too old for Stripe's 35-day reporting window, is frozen for manual reconciliation rather than blindly resubmitted and potentially charged twice. Inspect Test Mode resources/event logs against the stored operation/outbox before repairing synchronization state; do not delete the ledger or fabricate payment records. The endpoint exposes pending usage and synchronization issues. Monitor worker warnings and Stripe webhook delivery failures; durable ledgers do not replace operational alerting.

### Local testing and deployment

Use Stripe's official CLI and a **Test Mode** account. Configure Test products/prices/meter/portal privately, set `STRIPE_ENABLED=true`, start Nest, and forward signed events:

```bash
stripe listen --forward-to localhost:3000/payments/webhook
```

Put the CLI's signing secret into the private local environment and restart; never paste it into source, logs or issue reports. For deployment register `https://YOUR_API_DOMAIN/payments/webhook` with the supported event list and API `2026-08-26.dahlia`, and use **that endpoint's** Test Mode signing secret. Nest enables `rawBody: true` so cryptographic verification receives unmodified bytes; Helmet, CORS, strict DTO validation and the normal JSON size limit remain enabled for all other routes. Do not install middleware that parses/reformats the webhook body before Nest captures it.

Register and activate a company, sign in as owner, request Checkout and open its returned URL. Use Stripe's documented Test card `4242 4242 4242 4242` with a future expiry and test CVC in **Stripe's hosted page only**. Return to the frontend and poll `/payments/current`; never use the redirect as payment proof. Confirm webhook retries, subscription creation, original anchor, zero/nonzero Basic seats, Premium meter events and draft reconciliation in Test Mode. The automated suite uses controlled dates for leap years and month-end anchors and mocks all Stripe APIs without external calls. For provider-level renewal tests use actual Test Mode anniversaries or isolated Stripe Test Clock fixture customers with a matching controlled backend clock and disposable database; the normal API never accepts a frontend test-clock ID. Verify failure/recovery, month-end downgrade/cancellation and invoice totals in that isolated environment. Run provider-level tests before declaring the integration deployment-ready.

Relevant official references: [hosted card setup](https://docs.stripe.com/payments/save-and-reuse-cards-only), [billing-cycle anchors and no-proration behavior](https://docs.stripe.com/billing/subscriptions/billing-cycle), [meter event recording and limits](https://docs.stripe.com/billing/subscriptions/usage-based/recording-usage-api), and [draft invoice line updates](https://docs.stripe.com/api/invoices/update_line). Live payments, tax, refunds, arbitrary portal plan changes, trial campaigns, and a historical local invoice database are outside this Test Mode feature.
