# Repository guidelines for coding agents

## Read before editing

Read [README.md](README.md), the [documentation index](docs/README.md), [architecture](docs/architecture.md), and the relevant feature documentation before changing code. Read [the stabilization roadmap](docs/stabilization-roadmap.md) for completed work and outstanding limitations. Inspect existing implementations and tests before assuming a feature is missing. Prefer small changes that preserve working behavior; avoid unnecessary architectural rewrites.

## Boundaries and conventions

- `src/` is the NestJS/TypeScript API, organized by feature. Keep controllers, services, DTOs, entities, and Jest unit tests together. HTTP regression tests live in `test/`.
- `frontend/` is a separate Next.js App Router application with JavaScript, React, and Tailwind CSS. Routes live in `app/`, UI in `components/`, helpers in `lib/`, and Playwright tests in `tests/`. Read [frontend/AGENTS.md](frontend/AGENTS.md) before editing frontend code, including the installed Next.js documentation rule.
- Use Node 24 (`.nvmrc`) and install dependencies separately in each package with `npm ci`. Use API port 3001 and frontend port 3000 for local development. `dist/`, `.next/`, and test reports are generated output.
- Use two-space indentation and Prettier. Backend TypeScript uses single quotes and trailing commas. Name Nest files by role, for example `files.service.ts` and `file-permissions.dto.ts`. Follow existing frontend components and styling.

## Security and behavior to preserve

Read [security](docs/security.md), [admin boundaries](docs/admin.md), [AI](docs/ai.md), and [billing](docs/billing.md) when touching those features.

- Derive tenant identity and permissions from the authenticated database user and company. Never authorize from frontend-supplied company IDs, role claims alone, or filter parameters. Retain RBAC, account/company status checks, token purpose, and session-version checks.
- Keep platform-admin authentication separate from tenant authentication. Tenant owners are not platform administrators. Keep admin data projections, search, filters, and pagination server-side and within the authorized scope.
- Keep S3 objects private and enforce file access before download, deletion, and permission changes. Preserve validation, plan limits, upload compensation, and private/restricted visibility. Do not log file content, signed URLs, credentials, sensitive AI tool arguments, or tokens.
- Preserve sequential multi-file upload selection, per-file progress, partial success, retry/cancellation behavior, and duplicate-submission guards. An uncertain upload outcome must not trigger an automatic retry; reconcile with the server before another mutation.
- Preserve AI chat history/formatting, duplicate guards, accessible reduced-motion loading states, timeout recovery, tool calls, OpenRouter primary/Gemini fallback, usage accounting, and quotas. Local cancellation does not prove server processing stopped. Never fabricate processing stages or reveal private reasoning. Do not send sensitive file content to external providers without the required privacy approval and user authorization.
- Preserve Stripe test-only validation, webhook verification, durable usage reporting, and owner-only payment mutations. Internal billing estimates are distinct from Stripe invoices; redirect/query parameters never establish payment status.
- Sensitive Data Guard implementation requires architecture/security review before significant schema changes or external processing. Documentation is not authorization to implement it.

## Verification and dependencies

Use the exact package-specific commands in [development and testing](docs/development.md). Add focused tests for changed behavior, especially authentication, tenant isolation, billing, and file access. Run relevant formatting, lint, unit/HTTP/browser tests, and builds for the affected package. Root lint and CI do not cover the frontend; the frontend currently has no lint script. Use `npm run build -- --webpack` for its production check.

Playwright expects a running frontend on `http://localhost:3000`. Its unfiltered suite includes live external-service checks. Use the documented exclusion for isolated browser regressions; never present mocked responses as proof of live integrations. Documentation-only changes need link, command, and formatting validation rather than unrelated application changes.

Review dependency changes for necessity, maintenance, license, and security. Update the appropriate manifest and lockfile together. Run `npm audit --audit-level=high` in affected packages when dependencies change; report unresolved advisories and do not use `npm audit fix --force` blindly.

## Git and safe collaboration

Inspect `git status` and the diff before editing. Preserve unrelated contributor changes and previous stabilization work. Do not replace entire files with another implementation, reset the worktree, or discard changes to simplify a task. Reconcile selectively. Do not apply/pop/delete stashes without explicit permission.

Do not commit, push, deploy, modify production secrets, delete production data, or run destructive maintenance scripts without explicit permission. Copy example environment files only when the ignored destination does not already exist. Keep backend secrets out of `NEXT_PUBLIC_*`; use placeholders in documentation and never print real environment values.

When authorized to commit, use concise `feat:`, `fix:`, `docs:`, `ci:`, or `chore:` subjects. In reviews/PRs, explain behavior and relevant verification, including screenshots for UI changes. On completion, report changed files, checks run and their results, remaining risks, and anything not actually verified.
