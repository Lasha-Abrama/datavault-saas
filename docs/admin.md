# Platform administration and maintenance

Reviewed against repository code on 2026-10-11. [Documentation index](README.md).

Privileged bootstrap, reset, maintenance, and live smoke-test commands below require explicit authorization and a verified database target. They are not normal onboarding checks.

## DataVault platform administration

A **platform administrator** is a separate identity in `platformadmins`, with no company membership. A `company_owner` administers only their own tenant and cannot access `/admin`. Platform tokens cannot authenticate to tenant endpoints, including file downloads. There is no public endpoint that directly grants platform access, impersonation, company deletion, administrator-to-administrator password editing, quota editing, or provider-state editing API.

### Bootstrap and authentication

Build first and run the explicit bootstrap command against the intended MongoDB replica set. Supply these CLI-only variables privately through an environment/secret manager or the local ignored `.env`; never put credential values into shell history or source:

CLI-only values are listed in the [environment reference](environment.md#platform-admin-bootstrap).

```bash
npm run build
npm run admin:bootstrap
```

Bootstrap starts only an isolated database application context, without HTTP, SMTP, S3 or payment workers. It awaits indexes and creates the bcrypt cost-12 password hash and bootstrap audit entry transactionally. Repeating the command for an existing email leaves credentials unchanged; it does not reset passwords or reactivate disabled administrator identities. Creating another explicit email is also a privileged CLI operation. Remove bootstrap credentials from runtime configuration after use. Command output never contains identity or credential values.

An active platform administrator can select **Forgot admin password?** on `/admin`. The API emails a one-time reset link to the account's email through the configured SMTP or Resend sender. The link points to `/admin` on the `ACCOUNT_ACTIVATION_URL` origin, expires after 30 minutes, and can be used once. A new password must meet the bootstrap policy. Resetting invalidates earlier platform sessions. The request response does not reveal whether the email belongs to an administrator. Verify that the activation URL's origin is the frontend serving `/admin`.

If email recovery is unavailable, build and run the dedicated interactive maintenance command:

```bash
npm run build
npm run admin:reset-password -- --confirm-platform-admin-password-reset
```

The command requires the exact existing administrator email, a new password entered twice, and the exact email entered again, all through non-echoing TTY prompts. The new password uses the same 12-character/72-byte, uppercase, lowercase, digit and special-character policy and bcrypt cost 12 as bootstrap. It refuses unknown or inactive administrators and has no force/reactivation mode. One MongoDB transaction changes only that administrator's password and appends a `password_reset` audit event; no password or hash is stored in the audit record. It also invalidates earlier platform sessions and pending email reset links. It never starts HTTP or calls tenant, Stripe, S3 or SMTP services.

`POST /admin/auth/login` accepts `{ "email": "…", "password": "…" }` and returns `{ "accessToken": "…" }`. Login is limited to 5 requests/minute per IP with the existing in-memory throttler. Administrator JWTs last 30 minutes and use HS256 with explicit issuer, audience and token purpose. Their signing key is derived from `JWT_SECRET` using HKDF-SHA256 with a separate purpose; rotating `JWT_SECRET` invalidates both tenant and platform tokens. Every admin request checks the administrator's current `isActive` database state. Successful and credential-failed logins are audited; unknown accounts are recorded without submitted identity information. Authentication fails closed if audit persistence fails.

### API

All endpoints below require a platform token in `Authorization: Bearer …`, are limited to 60 requests/minute per IP, and return `Cache-Control: private, no-store`:

| Endpoint                               | Behavior                                                                                                                                                                                                                                                                                                                                                             |
| -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /admin/dashboard`                 | Global company activation/suspension/plan counts, owner/member counts, live pending invitations, stored file/visibility counts, sum of current company-period upload counters, and local Stripe-managed/payment-attention counts when enabled. No provider calls.                                                                                                    |
| `GET /admin/companies`                 | Company profiles with safe subscription synchronization metadata. Filters: `search` (company name), `activation=activated\|pending`, `status=active\|suspended`, `plan=free\|basic\|premium`, `paymentAccess`, `stripeManaged=true\|false`. Sort: `createdAt`, `name`, `updatedAt`.                                                                                  |
| `GET /admin/companies/:id`             | Profile/status history marker, safe owner identity, accepted employees/pending invitations, stored file counts, existing subscription/billing-period estimate, safe Stripe identifiers/status/synchronization metadata, and missing owner/subscription warnings.                                                                                                     |
| `POST /admin/companies/:id/suspend`    | Body `{ "reason": "security_review" }`; allowed reasons: `security_review`, `policy_review`, `operational_hold`. Status and audit entry commit together.                                                                                                                                                                                                             |
| `POST /admin/companies/:id/reactivate` | Empty body `{}`; records server-selected `review_completed` reason and audit entry.                                                                                                                                                                                                                                                                                  |
| `GET /admin/users`                     | Safe tenant-user identity metadata only. Filters: `search` (email/name), `companyId`, `role`. Sort: `createdAt`, `email`, `fullName`.                                                                                                                                                                                                                                |
| `GET /admin/files`                     | File metadata only. Filters: `search` (filename), `uploaderSearch` (name/email), `userId`, `companyId`, `visibility`, `fileType`. Results include safe uploader/company identity. The UI supports user drilldown, server pagination/sorting, and loading/empty/retry states. Sort: `createdAt`, `originalFilename`, `size`. No storage keys, links or file contents. |
| `GET /admin/audit-logs`                | Append-only security history. Filters: `action`, `actorId`, `targetId`; chronological sorting. No update/delete API.                                                                                                                                                                                                                                                 |

Lists return `{ "items": [], "pagination": { "page": 1, "limit": 25, "total": 0 } }`. Pagination is bounded to pages 1–1,000 and 1–100 items; `order=asc|desc` is allowlisted. Search is literal, case-insensitive, at most 80 characters; client regular expressions/operators and unknown DTO fields are rejected. List aggregation timeouts are 5 seconds, dashboard aggregation timeouts 10 seconds. Search may scan at large scale; assess actual query performance before increasing limits.

Dashboard counts are operational read-time observations, not one transactionally frozen global snapshot. Current-period totals sum recorded rows whose activation-anchored period contains the request time; companies without a period row have zero recorded usage. Stored file counts differ from historical successful uploads: deleting a file never refunds usage. Recorded overage and company billing estimates are **not collected revenue or Stripe invoices**. Payment-attention counts use existing local payment access, synchronization issue and 24-hour freshness policy; no live Stripe calls are made for dashboard/detail reads.

### Suspension and audit policy

Platform status is independent of email activation and payment access. Legacy companies without a status remain active. Suspension blocks fresh password/Google sign-in and every subsequent tenant JWT authorization check, including already-issued JWTs. Public invitation acceptance also rejects suspended companies without consuming the invitation. An operation already authorized before suspension is not forcibly interrupted; subsequent requests check committed database status. Suspension does not delete data, revoke invitations, change plans/anchors/usage, cancel Stripe subscriptions or touch S3. Stripe webhooks and reconciliation continue to maintain provider state.

Reactivation restores access for unexpired tenant JWTs and permits login, while existing activation/payment/entitlement restrictions still apply. It never activates an unverified company or clears a payment restriction. Repeated status transitions return 409; missing companies return 404. Concurrent transitions use conditional writes in a MongoDB transaction, and audit failures roll back the status change.

Audit records contain only actor/target IDs, enum action/reason/status and creation time; no submitted credentials, arbitrary request bodies, tokens, payment methods or customer-sensitive payment data. Records have no TTL. Mongoose rejects audit updates/deletions/replacements and bulk rewrites; no API exposes these mutations. Restrict direct database administration privileges separately: schema middleware is not a tamper-proof boundary against privileged direct database access. Projections hide password hashes, verification/invitation tokens, lease/operation internals, webhook data, storage keys, AWS/SMTP/Stripe secrets and file contents. Existing tenant APIs remain the only file-content access path and reject platform tokens.

### Disposable unactivated signup cleanup (CLI only)

There is no company deletion API. Signup commits a company, owner, Free subscription and verification record before attempting SMTP delivery; an email failure can therefore leave a saved, unactivated signup. Email activation consumes the verification record and sets **Company** `activatedAt`. The Free subscription's separate `activatedAt` anchor is populated during signup and must not be mistaken for email activation. Verification records can expire through MongoDB TTL, so their absence alone does not prove activation or disposability.

Use a trusted local API client with a platform JWT to identify your exact accidental signup: `GET /admin/users?role=company_owner&search=…` searches safe email/name metadata and returns its `companyId`; `GET /admin/companies/:id` confirms company name, owner email, activation and subscription state. Check both identity and company ID against the signup you personally created. Keep authentication headers out of shared workspaces, saved requests and terminal history. The utility cannot infer whether an email is fake or inaccessible; an eligible legitimate pending signup must never be selected.

With the intended **development/test** database configured privately through `MONGO_URI` and explicit `NODE_ENV=development` or `test`, build and inspect only:

```bash
npm run build
npm run maintenance:cleanup-disposable -- --company-id REPLACE_WITH_EXACT_COMPANY_ID
```

This defaults to a read-only transactional dry run and returns only the company ID, eligibility, mode and record counts. It creates no collections/indexes and loads no tenant HTTP server, payment workers, SMTP or S3 services. Production, unspecified environments, selectors, bulk operations, force flags and invalid IDs are rejected. Environment labeling is a guard, not proof of the database target: never relabel a production database to bypass it.

If the dry run is eligible **and you independently confirmed it is your disposable signup**, stop **every API instance, reconciliation worker and other database writer** using that database, then run:

```bash
npm run maintenance:cleanup-disposable -- --company-id REPLACE_WITH_EXACT_COMPANY_ID --confirm-disposable --confirm-app-stopped
```

The second run rechecks everything inside the deletion transaction. `--confirm-app-stopped` attests an offline maintenance window; the utility cannot detect all other processes. Do not run while application instances, CLI writers or manual database edits remain active. Conditional writes and transaction conflicts protect competing activation/record changes; offline maintenance additionally prevents phantom dependent inserts.

Deletion refuses anything outside the untouched signup shape: non-null/missing company activation, suspended/reactivated status history, changed timestamps/version/unknown fields, missing or duplicate owner/subscription, any accepted employee, non-Free plan, accounting revision, payment restriction, any Stripe identifier/operation/history/outbox, any stored-file/uploader reference, any invitation/inviter reference (including expired/revoked ones still present), **any billing-period row even with zero usage**, any AI conversation/message/usage reference, inconsistent verification ownership, or audit references to the company/owner. Historical string references are also checked case-insensitively rather than silently omitted by ObjectId casting. An expired verification record may be absent; a resent verification record may remain.

Only that exact company, its single owner, pristine Free subscription and zero/one verification records can be removed. All deletions use one snapshot/majority transaction with exact count checks; failures roll back partial work. Audit history is never deleted. It never contacts Stripe/AWS/SMTP or attempts S3 cleanup. A refusal requires investigation, not removing the safeguards. Reports contain no email, password/hash, verification token or database/provider exception text. Restart the application after maintenance. Repeat deletion reports `company_not_found`, not success.

### Reset an unused Stripe Test Mode customer mapping (CLI only)

After moving a **development/test** database to another Stripe Test Mode account, an old customer ID can prevent a new hosted Checkout. This command handles only an existing company that is still on the local **Free** plan with an unused Stripe customer mapping. It refuses Stripe-managed or paid subscriptions, a known subscription ID/status, a checkout session or attempted checkout/subscription creation, pending plan/schedule/lease/meter/sync state, and any company-scoped Stripe webhook-event or metered-usage record. A refusal means the old account and DataVault state require individual reconciliation; do not manually force a paid plan into an unmanaged state. It never calls Stripe or changes company/users/files/invitations, billing-period/upload records, AI records or platform-admin data. It does not delete webhook history or the usage outbox.

Build, set `NODE_ENV=development` or `test` for the intended non-production database, and **dry-run** with the exact company ObjectId:

```bash
npm run build
npm run maintenance:reset-stripe-test -- --company-id REPLACE_WITH_EXACT_COMPANY_ID
```

The JSON report lists field **names**, not Stripe identifier values, and gives the subscription `revision`. Confirm the company and plan independently. Before execution, configure the **new account's Test Mode** `STRIPE_SECRET_KEY` privately (the CLI checks its `sk_test_` shape but never calls Stripe or prints it), stop **all** API instances, payment workers and other writers using that database, and confirm no old-account Checkout/subscription operation or webhook delivery remains in flight. The CLI cannot inspect the old Stripe account or prove that distributed processes are stopped. Then use the revision from the dry run:

```bash
npm run maintenance:reset-stripe-test -- --company-id REPLACE_WITH_EXACT_COMPANY_ID --expected-revision REPLACE_WITH_DRY_RUN_REVISION --execute --confirm-reset --confirm-app-stopped --confirm-old-stripe-quiescent
```

Execution rechecks the exact company and subscription under a snapshot/majority MongoDB transaction, conditionally increments `revision`, and clears only Stripe provider mapping/operation/synchronization fields. It retains the Free plan, activation/billing anchor and all authoritative usage. `NODE_ENV=production` or an unset environment is refused even for a dry run. The confirmation flags are operator attestations, not process detection. No HTTP reset endpoint exists. The old Stripe customer remains in the old Test Mode account; handle that account separately if needed. Restart the application only after maintenance is complete.

For the **separate, exact unmanaged Basic recovery case**, add `--recover-unmanaged-basic` to the dry run. This mode applies only when a local Basic subscription has `stripeManaged=false`, `paymentAccess=unmanaged`, `paymentSyncIssue=retry_required`, an old **Test Mode setup Checkout** for Premium, and no Stripe subscription ID or subscription-creation attempt. It also requires no company-scoped Stripe event/outbox records, exactly one owner and no employees, no live pending invitations, at most the Free allowance of successful uploads in the current activation-anchored period, and no recorded overage. These are the same capacity constraints used for a Free downgrade. A completed setup Checkout alone does not collect payment or create a subscription; DataVault creates the subscription in a later step, after recording its attempt. Any evidence that step began, any paid/managed state, or a failed Free capacity check causes refusal. Do not clear those states manually.

```bash
npm run maintenance:reset-stripe-test -- --company-id REPLACE_WITH_EXACT_COMPANY_ID --recover-unmanaged-basic
```

After independently reviewing the dry-run report and stopping every writer, confirm that the old Test Mode account has no in-flight Checkout/webhook activity. Run from an isolated `development`/`test` maintenance process connected only to the intended staging database, not from the Render production-mode web process. With the new account's `sk_test_` secret configured privately, use **the Basic recovery revision from this dry run**:

```bash
npm run maintenance:reset-stripe-test -- --company-id REPLACE_WITH_EXACT_COMPANY_ID --recover-unmanaged-basic --expected-revision REPLACE_WITH_DRY_RUN_REVISION --execute --confirm-reset --confirm-transition-to-free --confirm-app-stopped --confirm-old-stripe-quiescent
```

This transaction changes only that company's subscription: `planCode` becomes `free`, `planChangedAt` becomes the recovery time, `revision` increments, payment access/sync state becomes unmanaged/none, and old Stripe mapping/operation/sync fields are cleared. The original `activatedAt` billing anchor and every user, invitation, file, subscription-period/upload counter, AI record, other tenant and Stripe event/outbox record remain untouched. The old customer/setup session remain in the old Stripe account. After restarting DataVault with the new Test Mode account, the owner may begin a new hosted Checkout. A company that cannot fit Free needs explicit account/payment reconciliation; this utility cannot grant or preserve unpaid Basic access.

### Real API platform-admin smoke test

Run against a local/test Nest API, with normal SMTP and frontend activation available. Use a **new accessible email address** (an operator-controlled alias works) and a dedicated password; each run registers a new fixture. Never supply an existing tenant/account. Start the application normally, then in an interactive terminal:

```bash
npm run build
npm run admin:smoke -- --base-url http://127.0.0.1:3000 --confirm-test-tenant
```

The helper accepts only loopback origins (or a locally forwarded test API), refuses URL credentials/query/path fragments, follows no redirects, and requires a TTY. Choose `token` to enter a platform JWT or `login` to enter platform email/password. All answers, including tenant email/password and JWTs, use hidden prompts; never pass them as arguments, pipe them from files, or enable HTTP tracing. Tokens and snapshots remain in process memory and are not printed/persisted. Only fixed checkpoint labels, HTTP failure status and the generated fixture name/company ID are output. Bootstrap `.env` values are not modified or used by this helper.

It validates platform access **before registration** and registers a unique `DataVault admin smoke …` company using the supplied company profile. The activation email URL is a frontend route: production frontend code must read its `token` query parameter and send `POST /auth/verify-account` with JSON `{ "token": "…" }`. For development without that frontend, the CLI securely prompts for either the full activation URL copied from the email or its raw token, validates it without printing it, and calls that same normal backend endpoint. It never calls an activation bypass or edits MongoDB. It then signs in, retains the original tenant JWT, proves normal tenant access and `/admin` rejection, and verifies that the exact fixture is Free, empty, employee/invitation-free and Stripe-unmanaged before any suspension.

Choose `login` to obtain a fresh 30-minute platform token, then enter the bootstrap admin email and password. The hidden prompt safely accepts normal bracketed terminal paste. Authentication is verified before tenant details are requested. Safe failure stages distinguish rejected credentials, a rejected supplied JWT, a newly issued JWT rejected by the dashboard, and unreachable, unavailable, or misconfigured admin endpoints; credentials and response bodies are never printed.

It suspends only that fixture, checks both the already-issued JWT and fresh login return 401, compares safe owner/subscription/billing/files/usage/Stripe metadata, reactivates, and proves the **original** JWT works again with unchanged business state. It never uploads files, invites employees, changes plans, calls `/payments` or touches other tenants. These are API-visible checks, not a live provider-state reconciliation or inspection of hidden internal fields.

After a failure following suspension, the helper attempts scoped reactivation only if that exact generated fixture still has its own `operational_hold` reason; competing security suspensions are not cleared. A lost HTTP response is handled through the same read/check/recovery path. If recovery fails or the process is forcibly terminated, inspect the generated fixture through `/admin/companies/:id` and reactivate only it when appropriate. Network/email failures may leave registration saved; use the printed unique fixture name to locate it instead of blindly rerunning with an existing email. No automatic registration/plan mutation retries are performed.

If registration succeeded but activation or tenant login interrupted the run, resume that exact generated fixture instead of registering another tenant:

```bash
npm run admin:smoke -- --base-url http://127.0.0.1:3000 --resume-fixture "DataVault admin smoke REPLACE_WITH_THE_EXACT_UUID" --confirm-test-tenant
```

Resume authenticates the platform administrator, searches for one exact generated fixture name, loads its admin detail, and refuses to proceed unless the owner email matches and the tenant is pristine Free state with no employees, invitations, files, usage, Stripe state, prior suspension, or integrity warning. A pending fixture prompts for its existing email activation URL/token and submits it once to `/auth/verify-account`; an already activated pristine fixture skips token submission. It then continues the normal login, isolation, suspension/reactivation, and state-preservation checks. Resume never calls signup or resend-verification and never rotates the token. A 400 at `activation` means the token is invalid, consumed, or expired; inspect whether activation already completed before considering the normal resend endpoint.

Successful smoke tests intentionally retain their **activated, reactivated fixture and audit history**. The unactivated cleanup utility must refuse them. Use a dedicated disposable test database for repeat runs rather than weakening cleanup rules to remove activated tenants. Complete activation within the administrator token's 30-minute lifetime; expired tokens fail safely.

Bootstrap failures now report only fixed categories: `invalid_bootstrap_configuration`, `mongo_connection_failed`, `mongo_index_failed`, `mongo_query_failed`, `mongo_transaction_failed` or `mongo_close_failed`. Invalid credentials/configuration are checked before connecting; index initialization and transactions are separately classified. Check configuration/permissions/replica-set support locally, without pasting raw errors or secrets into logs.

## Reviewed access requests

Public access requests do not create platform accounts. Email verification
precedes review by an active platform admin; approval sends a single-use setup
link. Password setup creates the account transactionally without issuing a JWT;
the applicant signs in afterward. Rejected requests cannot activate an account.
The exact API contract is in [the frontend handoff](../FRONTEND_HANDOFF.md#platform-admin-access-requests)
and Swagger. Verification, decisions, setup, and retries remain audited.

CLI examples above are operator procedures, not onboarding steps. Bootstrap,
password reset, smoke tests, and destructive maintenance require explicit
operator authorization and a confirmed database target. Dry-run reports are
not permission to execute deletion. Never weaken safeguards or delete ledgers,
audit records, or production data to make a test pass.
