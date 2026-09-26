# DataVault frontend

Next.js App Router, React, JavaScript, Tailwind CSS, and a custom responsive design system. All application data comes from the tenant API; test fixtures are confined to `tests/`.

## Run locally

Requires Node.js 22 or newer.

```sh
npm ci
# Copy .env.example to .env.local if it does not already exist.
npm run dev
```

Open http://localhost:3000. For production: `npm run build`, then `npm start`.

## Configuration

- `NEXT_PUBLIC_API_URL=https://datavault-saas.onrender.com` (no `/api` prefix)
- `NEXT_PUBLIC_STORAGE_ENABLED=false`. Change to `true` only after S3 upload, download, and deletion are verified on the backend; rebuild after changing public environment variables.
- Browser requests use the same-origin `/backend` gateway, which forwards only allowlisted tenant routes to `NEXT_PUBLIC_API_URL`, without adding any upstream prefix. This avoids the verified Render CORS block for localhost. The gateway forwards Bearer authorization and streams uploads/downloads; it never stores tokens or forwards cookies. Direct browser-to-Render clients still require exact allowed `CORS_ORIGIN` values.
- Render `ACCOUNT_ACTIVATION_URL` should be `https://<frontend>/activate`.
- Render `EMPLOYEE_INVITATION_URL` should be `https://<frontend>/employee-activate`.
- Do not copy backend secrets into this project.

## API contract

Read against `../FRONTEND_HANDOFF.md` and the deployed `/docs/openapi.json` on 2026-09-25.

| Feature | Endpoint | Notes |
| --- | --- | --- |
| Login, restore | POST /auth/sign-in; GET /auth/current-user | One-hour Bearer JWT in sessionStorage, cleared on logout/expiry; no cross-origin cookies |
| Register | POST /auth/sign-up | companyName, fullName, email, password, ISO alpha-2 country, industry |
| Activate, resend | POST /auth/verify-account; POST /auth/resend-verification | Token taken out of URL immediately; explicit activation avoids duplicate mutation under React Strict Mode |
| Join invitation | POST /invitations/accept | token, fullName, password; role/company assigned by backend |
| Company | GET/PATCH /companies/current | Only owner updates name, country, industry; company email is not an editable field |
| Profile/password | PATCH /users/:id; PATCH /users/me/password | fullName; currentPassword/newPassword |
| Overview | GET /statistics/current | Company-wide aggregates as explicitly exposed to both roles |
| Files | GET/POST /files; GET/DELETE /files/:id; GET /files/:id/download | Multipart file, visibility, JSON-array-string restrictedUserIds |
| Permissions | PATCH /files/:id/permissions | company_wide or restricted; owner or uploader |
| Employees | GET /users; DELETE /users/:id | Owner only |
| Invitations | GET/POST /invitations; POST /invitations/:id/resend; DELETE /invitations/:id | Owner only; handle ambiguous email failure without automatic mutation retries |
| Plans | GET /plans; GET/PATCH /subscriptions/current | Both roles can read; only owner changes planCode |
| Billing | GET /subscriptions/current/billing | Internal estimate, activation-anchored period; no payments or invoices |

## Backend limitations intentionally reflected in the UI

- Storage is disabled in the handoff. Upload, download, and deletion controls are gated; fully implemented upload/permission components become available with the storage flag.
- No forgot-password/reset-password endpoints exist. Those routes explain the limitation; authenticated password changes work. New passwords are limited to 20 characters because sign-in currently rejects longer values even though password change accepts up to 72.
- There is no public invitation-preview endpoint, so the join page does not invent a company name.
- There is no audit log, notification feed, workspace switcher, storage byte quota, or invitation-created timestamp. The app does not fabricate these. File search, format/access filters, sorting, and usage views are the additional features.
- Members cannot list employees. Their permission editor can retain/remove existing recipient IDs or select themselves; administrators have a searchable directory. Unknown uploaders are shown as “Company member” rather than guessing a name.
- API list endpoints cap each page at 30. Files and directories fetch successive pages, with cancellation on navigation, so filtering covers the complete accessible collection. For very large tenants, backend search and cursor pagination would improve performance.
- A reused activation token is indistinguishable from an invalid/expired one (HTTP 400). The UI offers sign-in and resend instead of asserting which happened.

## Validation

`npm run build` checks production compilation. `npm test` runs Playwright against an already running localhost:3000 server, using installed Microsoft Edge. Tests mock the documented API only within the browser test process. They cover session redirects, expiry, member restrictions, 403 handling, permission payloads, activation token removal, filtering, and mobile navigation/overflow. These are not substitutes for live authenticated integration tests.

No real account has been created or existing tenant data modified during development. A disposable activated account and verified email sender/storage are needed to complete live registration, invitation, upload, and mutation testing.


## Verified results (2026-09-25)

- Next.js 16.3.6 production build passed.
- Six Playwright browser tests passed (five isolated API-contract tests and one live read-only backend test).
- Live `/plans` returned the documented Free/Basic/Premium catalog through the gateway; live `/auth/current-user` correctly rejected missing authentication with HTTP 401.
- Direct browser requests were confirmed blocked by backend CORS. The same-origin gateway resolved this without modifying the backend.
- npm security audit after upgrading Next.js: zero reported vulnerabilities.
- Desktop login/overview and mobile registration/billing screenshots reviewed. No mobile horizontal overflow at 390px.
- Authenticated tenant mutations remain unverified against real accounts; no credentials were provided.

## AI Assistant

The persistent lower-right chat widget integrates POST `/ai/chat`, GET `/ai/conversations?page=1&limit=20`, GET `/ai/conversations/:id`, and DELETE `/ai/conversations/:id`. Both roles have access to their own conversations. Model/provider configuration is server-controlled. If the backend returns `ai_disabled`, the page disables sending and explains that the service needs enabling; saved history remains readable. No API key is needed or accepted by this frontend. See `BACKEND_FEATURE_AUDIT.md` for the full feature comparison and deployment prerequisites.

The chatbot opens over the current page, preserves its draft when minimized or during client navigation, and has an inline History view. The login screen shows a sign-in prompt. The former /dashboard/assistant route redirects to the dashboard with chat open. The visual refresh uses softer surfaces, rounded controls, lighter borders, and responsive spacing. Production build and nine browser tests passed after this update.

