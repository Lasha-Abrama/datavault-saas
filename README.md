# DataVault SaaS backend

NestJS backend for DataVault with company-based tenant isolation, internal plan/subscription entitlements, email onboarding, and private CSV/XLS/XLSX file storage. External payment integration has not been added.

## Requirements

- Node.js 24 (see `.nvmrc`; supported range is declared in `package.json`)
- npm
- A replica-set-capable MongoDB deployment; onboarding and upload accounting use transactions
- An SMTP server for account-activation and employee-invitation email
- Optional Google OAuth credentials
- AWS S3 configuration for file operations

## Setup

```bash
npm ci
cp .env.example .env
npm run start:dev
```

`MONGO_URI`, a random `JWT_SECRET` of at least 32 characters, `ACCOUNT_ACTIVATION_URL`, `EMPLOYEE_INVITATION_URL`, and the required SMTP settings must be configured. The two application URLs should point to frontend pages that read the token and call `/auth/verify-account` or `/invitations/accept`, respectively. The application validates configuration during startup and requires HTTPS for non-local application URLs. Every supported setting is documented in `.env.example`.

The built-in public-auth limiter is process-local. A horizontally scaled deployment should configure a shared throttler store and a trusted proxy strategy appropriate to its hosting platform.

## Tenant model

A company stores its required name, uppercase ISO 3166-1 alpha-2 country, normalized industry, and activation timestamp. Company names are case-insensitively unique. The registration email and password belong to the owner User and are not duplicated on Company. Every user has one required, immutable `companyId` and one role: `company_owner` or `company_member`. User emails remain globally unique so authentication resolves one identity without requiring a tenant hint.

Sign-up atomically creates an inactive company, its owner, its Free subscription, and a hashed 24-hour activation token. The raw token is sent by SMTP after commit and is never stored. Password and Google sign-in are rejected until activation, and the authentication guard also reloads activation state on every protected request. Activated company owners invite employees by email; the 72-hour, single-use invitation is the only path that creates a `company_member`. Acceptance derives the company, email, and role from the stored invitation. Members can read and update only themselves. Only owners may list or delete employees, manage invitations, or invite employees. Owners cannot delete themselves or change their verified email because ownership transfer and email-change verification do not exist yet. Google OAuth signs in existing users and cannot bypass activation.

JWTs contain only the user id. Authentication reloads the user on every request and derives current company and role data from MongoDB. Tenant-owned queries also include `companyId`, preventing cross-company access even when a target id is known.

## Plans and subscriptions

The code-defined plan catalog is the source of truth and is idempotently synchronized to MongoDB on startup. Free includes 10 files per activation-anchored month and the owner only. Basic includes 100 files, up to 10 employees plus the owner, and costs $5 per employee per month. Premium includes 1,000 files, unlimited employees, costs $300 per month, and records $0.50 for each file over 1,000.

Each company has one subscription. Plan changes take effect immediately, preserve the original activation/billing anchor, and do not reset the current period's usage. A downgrade is rejected when accepted employees plus live pending invitations exceed the target plan. There are no payment, invoice, trial, cancellation, or provider states yet; a subscription record represents enabled internal entitlements only.

`GET /subscriptions/current/billing` returns an internal current-period estimate in integer USD cents. The response derives every value server-side from the authenticated company: the code-defined current plan supplies its base price, employee unit price, included upload allowance, and Premium overage unit price; the user collection supplies the current accepted employee count (the owner and pending invitations are not billed); and the current `SubscriptionPeriod` supplies successful uploads and overage already recorded when Premium uploads succeeded. The total is `baseAmountCents + employeeChargeCents + overageChargeCents`.

The estimate uses the current plan and current employee count because the assignment defines neither proration nor historical employee/plan charging rules. It is always labeled `current_plan_estimate_with_recorded_overage`, includes `planChangedInCurrentPeriod`, and is not an invoice or payment state. An immediate plan change retains the activation-day anchor and accumulated upload usage. Recorded Premium overage remains in the period after a downgrade, while the new plan controls future entitlements. A downgrade may therefore leave usage above the new file allowance; later uploads stay blocked until the next activation-anchored period. Period ends are exclusive, and day-29/30/31 anchors clamp to the last UTC day of short months before returning to the original day when possible.

`EntitlementsService` is the internal boundary for employee and file limits. Invitation creation reserves a seat, and acceptance converts that reservation into an employee in a transaction. Free permits no employees, Basic permits 10 employees plus the owner, and Premium has no employee limit. Successful file uploads record metadata and monthly usage in the same transaction; deletion never refunds an upload count.

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
- `POST /invitations` — activated company owner invites an employee; accepts only an email
- `GET /invitations` — company owner lists their company's live pending invitations
- `POST /invitations/:id/resend` — company owner rotates and resends a live invitation after the cooldown
- `DELETE /invitations/:id` — company owner revokes a pending invitation
- `POST /invitations/accept` — public employee acceptance with token, full name, and password
- `GET /users` — company owner lists users in their company
- `GET /users/:id` — self or company owner, within the company
- `PATCH /users/:id` — self or company owner, within the company
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
