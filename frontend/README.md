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
| Billing estimate | GET /subscriptions/current/billing | Internal estimate, activation-anchored period; distinct from Stripe invoices |
| Stripe test billing | GET /payments/current; POST /payments/checkout, /payments/portal, /payments/plan, /payments/cancel, /payments/reconcile | Owner-only payment setup, invoices, plan changes, and explicit synchronization |

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

## Google sign-in

Verification on 2026-09-28: formatting check and production build passed. Complete Playwright suite: **31 passed, 2 failed**, with both failures isolated to the deployed backend's HTTPS detection (OAuth start and exchange return 403). All 14 focused OAuth UI tests passed, including owner/member sessions, duplicates, replay, cancellation, network/server errors, malformed responses, mobile layout, and password-login recovery. This JavaScript project has no configured lint or standalone typecheck script; their optional script invocations performed no checks. No commit, push, backend changes, or production frontend deployment were performed.

Continues the `4dd5fc9` OAuth WIP. `/login` and `/auth/sign-in` share the existing auth page; Google is sign-in only. A normal browser navigation goes directly to `${NEXT_PUBLIC_API_URL}/auth/google` so the backend can set and validate its HttpOnly browser-state cookie. The gateway permits only POST `/auth/google/exchange`; it does not proxy OAuth start/callback or forward OAuth cookies.

The callback fragment is removed with history replacement before a single exchange attempt. `{ code }` is exchanged through the existing API client. Both login methods establish the same sessionStorage Bearer session, verify `/auth/current-user`, and redirect to the dashboard. Failed profile lookup clears the partial session. Pending restoration cannot overwrite a newer sign-in. Codes are not logged, stored, or automatically retried. Expired/replayed codes require a fresh Google sign-in. No Google credentials belong in the frontend.

Production configuration:
- Vercel: `NEXT_PUBLIC_API_URL=https://datavault-saas.onrender.com` (rebuild after changing).
- Render: `FRONT_URI=https://datavault-saas.vercel.app` and `GOOGLE_CALLBACK_URL=https://datavault-saas.onrender.com/auth/google/callback`.
- Google OAuth client: authorized redirect URI must exactly match the Render callback above. Keep client secret on Render. If Google's consent screen is in testing mode, use an allowed test user.

**Production blocker observed 2026-09-28:** a real HTTPS GET `/auth/google` returns 403 `HTTPS is required for Google sign-in`. The backend's HTTPS guard is seeing the upstream request as insecure. Its existing `TRUST_PROXY_HOPS` setting defaults to zero; the Render administrator must verify the trusted reverse-proxy path and set the correct hop count, then redeploy. Do not disable the guard, accept arbitrary forwarding headers, or blindly enable `trust proxy=true`. This is a deployment prerequisite, not a frontend credential issue. The live OAuth tests intentionally continue to fail until the deployed service honors HTTPS; they are not skipped or mocked.

Manual production verification after deploying these frontend changes:
1. Open `https://datavault-saas.vercel.app/login` in a private window. Use an existing, activated DataVault account with the same Google email.
2. Click Continue with Google. Confirm full-page navigation through Render to Google. Sign in and approve. The final destination must be `/dashboard`; the address must contain neither a code nor a JWT.
3. In DevTools Network, confirm exactly one POST to `/backend/auth/google/exchange` (200), followed by `/backend/auth/current-user` (200). Do not copy/export request bodies, tokens, HARs, or screenshots containing credentials. The exchange uses `{ code }`; only protected requests use Bearer authorization.
4. Refresh the dashboard; the session should survive. Test an activated invited member too: its dashboard works, and Employees is absent. Log out and confirm protected pages return to sign-in.
5. Start a new Google flow and choose Cancel/deny if Google offers it. Expect the friendly cancellation message on `/auth/sign-in`, a clean URL, and no exchange. A provider that skips consent may not offer this control; the exact backend cancellation redirect is also covered by automated tests.
6. Open `/auth/sign-in` directly: normal sign-in, no exchange. Open `/auth/sign-in#code=invalid`: clean URL and friendly invalid-link message. For expiry/replay, automated tests cover backend rejection without retaining real codes; avoid manually sharing or logging live codes.
7. To exercise a real expired exchange, block `**/backend/auth/google/exchange*` with DevTools request blocking before starting OAuth. Finish Google sign-in, wait over 60 seconds (the backend TTL), unblock, and resend that blocked request once from DevTools if your browser supports it. It must return 401. A second send of a previously successful exchange must also return 401. Do not export or retain the requests. Start a fresh Google flow to recover.
8. With exchange request blocking enabled, complete Google sign-in: expect a connection error with a usable sign-in form and no automatic retries. Unblock and start a fresh Google flow. Confirm email/password sign-in still works.
9. At mobile width, confirm both sign-in methods remain accessible and there is no horizontal overflow.

Backend contract limitation: unregistered/inactive Google identities or invalid browser-bound state can produce JSON 401 on the Render callback rather than redirecting to the frontend. Return to `/login` and use an eligible account. The frontend does not bypass state validation or invent Google signup. End-to-end Google consent requires a real eligible account and is not proven by intercepted browser tests.

## AI Assistant

The persistent lower-right chat widget integrates POST `/ai/chat`, GET `/ai/conversations?page=1&limit=20`, GET `/ai/conversations/:id`, and DELETE `/ai/conversations/:id`. Both roles have access to their own conversations. Model/provider configuration is server-controlled. If the backend returns `ai_disabled`, the page disables sending and explains that the service needs enabling; saved history remains readable. No API key is needed or accepted by this frontend. See `BACKEND_FEATURE_AUDIT.md` for the full feature comparison and deployment prerequisites.

The chatbot opens over the current page, preserves its draft when minimized or during client navigation, and has an inline History view. The login screen shows a sign-in prompt. The former /dashboard/assistant route redirects to the dashboard with chat open. The visual refresh uses softer surfaces, rounded controls, lighter borders, and responsive spacing. Production build and nine browser tests passed after this update.

## Stripe return routes and backend setup

Verified against deployed Swagger and the backend payment service on 2026-09-27. The current backend supports **Stripe test mode only**. No frontend Stripe secret, publishable key, or Stripe SDK is needed; the server creates hosted sessions.

Configure these on **Render**, using the exact origin where this frontend runs:

```env
STRIPE_CHECKOUT_SUCCESS_URL=https://<frontend-host>/payments/success
STRIPE_CHECKOUT_CANCEL_URL=https://<frontend-host>/payments/cancel
STRIPE_PORTAL_RETURN_URL=https://<frontend-host>/payments/return
```

For local development, these pages exist at `http://localhost:3000/payments/success`, `/payments/cancel`, and `/payments/return`. Backend validation permits HTTP localhost callbacks only outside production; with `NODE_ENV=production`, **all three callback URLs must use HTTPS**, including localhost. A deployed HTTPS frontend or an explicitly configured HTTPS development origin is needed for that environment. `/settings/billing` is a compatibility alias for the backend's previous example portal return URL. No `session_id` query parameter is required: state is fetched using the authenticated company. Query parameters never prove payment, select a plan, or supply a redirect destination, and are removed on the return pages. The existing sessionStorage bearer survives same-tab Stripe navigation; expired sessions are sent through sign-in with a tightly allowlisted return path.

The server must enable `STRIPE_ENABLED` and configure its test secret, catalog, webhook, and restricted portal before hosted flows work. The frontend discovers availability through owner-only `GET /payments/current`. A generic outage blocks plan mutations; only the explicit disabled response allows the existing unpaid workspace-plan assignment. Stripe-managed accounts may still reject assignment on the backend.

Checkout saves a test payment method and does not collect payment immediately. Existing paid subscriptions use `/payments/plan`; Free uses `/payments/cancel`. Pending changes and period-end cancellation are displayed from server state, including a Keep-current-plan action. Return pages perform only reads until the owner explicitly chooses Synchronize with Stripe. No mutation is automatically retried.

Billing tests use isolated provider responses for disabled/outage states, checkout payload and redirect, scheduled cancellation and keeping a plan, pending/success returns, reconciliation, session return routing, employee restrictions, invoice URL validation, and portal redirects. These checks do not substitute for an end-to-end Stripe test transaction with configured backend credentials.

