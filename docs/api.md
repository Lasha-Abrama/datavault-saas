# API conventions and Swagger

Reviewed against repository code on 2026-10-11. [Documentation index](README.md).

Swagger UI is `/docs`; JSON is `/docs/openapi.json` on the running API.
For the local port convention these are `http://localhost:3001/docs` and
`http://localhost:3001/docs/openapi.json`. There is no global `/api` prefix.
The controller/DTO code and generated schema are authoritative for routes,
validation, statuses, and response fields.

`tenant-jwt` and `platform-admin-jwt` are separate Swagger Bearer schemes.
Use only the matching scheme and never save real JWTs in shared collections.
The global validation pipe transforms supported DTO values and rejects unknown
fields. Read list DTOs: tenant files use `page`/`take` (maximum 30), platform
metadata uses `page`/`limit` (maximum 100), and AI has its own bounded query DTO.
Do not assume one pagination envelope or success status for every endpoint.

Clients distinguish 400 validation, 401 authentication, 403 permission/plan,
404 unavailable resource, 409 conflict, 429 throttling, and 5xx unavailable or
uncertain outcomes. Never automatically replay mutations after a network or
server error. Authenticated metadata, downloads, and AI history use private
cache rules. Webhooks use signed raw bodies rather than tenant JWTs.

## Current API

- `GET /health/live` — process liveness
- `GET /health/ready` — MongoDB readiness
- `POST /auth/sign-up` — creates a pending company, optional owner profile, Free subscription, and activation token; requires `companyName`, `email`, `password`, `country`, and `industry`
- `POST /auth/verify-account` — consumes a single-use activation token
- `POST /auth/resend-verification` — generic, cooldown-protected resend response
- `POST /auth/forgot-password` and `POST /auth/reset-password` — generic email recovery and single-use reset; successful reset invalidates prior tenant sessions
- `POST /auth/sign-in`
- `GET /auth/current-user` — authenticated
- `GET /auth/google` and `GET /auth/google/callback` — optional browser-bound Google authentication; callback redirects existing users to sign-in and new users to registration
- `POST /auth/google/exchange` — atomically consumes the code and returns a tenant JWT
- `POST /auth/google/register` — completes Google registration with company details and returns a tenant JWT
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
- `POST /ai/chat` — activated owner/member general AI chat with optional owned `conversationId`
- `GET /ai/conversations` — caller-owned paginated conversation list
- `GET /ai/conversations/:id` — caller-owned conversation and user-visible history
- `DELETE /ai/conversations/:id` — hard-delete caller-owned conversation content

See [admin routes](admin.md#api), [Stripe routes](billing.md#api-and-hosted-setup-flow), and [frontend integration details](../FRONTEND_HANDOFF.md). The frontend gateway allowlist in `frontend/app/backend/[...path]/route.js` must be updated alongside any intended browser-facing route. Google start/callback and Stripe webhook are direct backend routes, not gateway routes.
