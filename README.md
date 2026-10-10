# DataVault

DataVault is a company-based, multi-tenant SaaS application with a NestJS API
and a Next.js frontend. It supports account activation, employee invitations,
owner/member permissions, private CSV/XLS/XLSX storage, plan entitlements,
internal billing estimates, platform administration, and an optional AI assistant.

Stripe integration is **Test Mode only**. Google OAuth, S3, transactional email,
and AI providers require their own configuration. Sensitive Data Guard is proposed
work, not an implemented inspection/redaction feature.

## Stack and layout

- Node.js 24 and npm; NestJS 11 with TypeScript, Mongoose/MongoDB, JWT and DTO validation.
- Next.js 16 App Router, React 19, CSS and Lucide icons.
- Private AWS S3 storage, Nodemailer SMTP or Resend, optional Stripe, OpenRouter and Gemini.
- Jest/Supertest for the API; Playwright and Node test helpers for the frontend.

```text
src/          Nest feature modules, services, DTOs, entities, unit tests
  admin/      Separate platform identities, metadata directory and audits
  ai/         Conversations, read-only tools and provider routing
  files/      Validation, tenant metadata, quotas and storage lifecycle
  payments/   Stripe Test Mode and durable reconciliation
  config/     Startup validation and HTTP security configuration
test/         HTTP regression suites and isolated infrastructure fixtures
frontend/
  app/        Next routes/layouts and the /backend gateway
  components/ Workspace, auth, files, admin, billing and assistant UI
  lib/        API/session helpers and upload safety
  tests/      Browser tests and upload-helper unit tests
docs/         Canonical architecture, configuration and operational guidance
```

## Start locally

Prerequisites: Node 24 (see [.nvmrc](.nvmrc)), npm, a MongoDB replica set or sharded
cluster, and a configured SMTP or Resend sender. A standalone MongoDB is not
supported. S3 is needed for file upload/download/delete; Stripe, Google OAuth,
and both AI providers can stay disabled while developing other screens.

In the repository root:

```sh
nvm use
npm ci
cp .env.example .env
```

Copy only if `.env` does not already exist. Fill the ignored file privately using
[the environment reference](docs/environment.md). These are placeholders and
local routing values, not a runnable credential set:

```env
NODE_ENV=development
PORT=3001
MONGO_URI=<private replica-set URI with database name>
JWT_SECRET=<random signing secret of at least 32 characters>
ACCOUNT_ACTIVATION_URL=http://localhost:3000/activate
EMPLOYEE_INVITATION_URL=http://localhost:3000/employee-activate
EMAIL_PROVIDER=smtp
SMTP_HOST=<your SMTP hostname>
SMTP_FROM=<your verified sender email>
```

Supply the selected email provider's TLS/authentication settings too. Keep unused
Google and AWS groups blank; leave `STRIPE_ENABLED`, `OPENROUTER_ENABLED`, and
`GEMINI_ENABLED` false until configured. Then start the API:

```sh
npm run start:dev
```

In a second terminal, install and configure the frontend separately:

```sh
cd frontend
npm ci
cp .env.example .env.local
```

Copy only if `.env.local` does not already exist. Set
`NEXT_PUBLIC_API_URL=http://localhost:3001` there, then run `npm run dev`.
Open `http://localhost:3000`. API Swagger is `http://localhost:3001/docs`.
The API defaults to port 3000, so explicitly using 3001 avoids the frontend port.

Frontend requests normally use the same-origin `/backend` gateway; Google OAuth
start/callback use direct API navigation. Direct cross-origin API clients need
an exact `CORS_ORIGIN` allowlist. See [development and testing](docs/development.md)
and [troubleshooting](docs/troubleshooting.md).

## Checks and production builds

From the repository root:

```sh
npm run format:check
npm run lint
npm run build
npm test -- --runInBand
npm run test:e2e -- --runInBand
npm audit --audit-level=high
```

From `frontend/`:

```sh
npm run test:unit
npm test -- --grep-invert 'live\.spec\.js'
npm run build -- --webpack
npm audit --audit-level=high
```

Browser tests require a running frontend and installed Playwright Chromium.
Unfiltered `npm test` also includes live-network checks in `tests/live.spec.js`.
There is no separate frontend lint script. Run `npm run format` in the package
you changed; documentation formatting commands are in [development](docs/development.md).
Backend CI checks formatting, lint, build, unit/HTTP tests and high-severity npm
advisories; it does not run frontend checks or deploy.

## Deployment

The intended split is a long-lived Nest web service on Render and the Next.js
application on Vercel with `frontend/` as its project root. Build/start commands,
health probes, gateway constraints, OAuth callbacks, Brevo SMTP and provider
checks are in [deployment operations](docs/deployment.md). Host settings are
managed outside the repository; no `render.yaml` or `vercel.json` is checked in.
Passing local tests does not verify live providers or deployed settings.

## Security and contribution

Tenant authorization derives company and role from the current authenticated
user in MongoDB; client IDs do not grant access. Platform administrators use
separate accounts and JWT signing purpose. File storage is private, and quotas
and mutation permissions are enforced in the API. Read [security boundaries](docs/security.md)
and [admin operations](docs/admin.md) before editing these paths.

Inspect existing code and `git status` before changes. Preserve unrelated work,
use small scoped changes, add regression coverage for affected boundaries, and
report checks and remaining risks. Follow [AGENTS.md](AGENTS.md); Claude Code
also loads [CLAUDE.md](CLAUDE.md). Use established `fix:`, `feat:`, `docs:`, `ci:`
or `chore:` commit subjects. Do not push, deploy, modify secrets, delete stashes,
or run destructive maintenance without explicit permission.

The package is private and `UNLICENSED`; this repository does not grant an
open-source license. Distribution, Terms of Service and Privacy Policy still
require owner/legal decisions.

## Documentation

Start with [the documentation index](docs/README.md). Detailed guides cover
[architecture](docs/architecture.md), [environment](docs/environment.md),
[API conventions](docs/api.md), [billing/Stripe](docs/billing.md),
[AI/fallback](docs/ai.md), [security/files](docs/security.md), and
[platform administration](docs/admin.md). The [stabilization roadmap](docs/stabilization-roadmap.md)
records implementation and dated verification; [frontend handoff](FRONTEND_HANDOFF.md)
is an integration contract with historical staging observations.
