# Development and testing

[Documentation index](README.md). Commands below are verified against the two
package manifests and CI configuration; run each in the stated directory.

## Prerequisites and setup

Use Node 24 (`nvm use` reads the root `.nvmrc`) and npm. Install dependencies with
`npm ci` separately at the root and in `frontend/`; keep both lockfiles.
Privately copy the example environment files only when the ignored target does
not already exist. Follow [root setup](../README.md#start-locally) with API port
3001 and frontend port 3000. MongoDB must support transactions and index creation;
startup checks capabilities and initializes required indexes before serving.
The code-defined plan catalog is synchronized on startup.

Email mode and sender configuration are mandatory even when provider features
such as AI/Stripe are disabled. A provider accepting mail does not establish
inbox delivery. Blank S3 settings permit startup and metadata work but storage
operations return a sanitized error. Do not connect development to production
or relabel a production database as `development` to bypass a CLI guard.

## Backend commands (repository root)

| Command                                   | Purpose                                                   |
| ----------------------------------------- | --------------------------------------------------------- |
| `npm run start:dev`                       | Nest watch server                                         |
| `npm run start:debug`                     | Watch server with Node debugger                           |
| `npm run format` / `npm run format:check` | Write/check backend and HTTP-test Prettier formatting     |
| `npm run lint` / `npm run lint:fix`       | ESLint / explicit autofix for `src` and `test` TypeScript |
| `npm run build`                           | Compile Nest to generated `dist/`                         |
| `npm run start:prod`                      | Run the built API (`node dist/main`)                      |
| `npm test -- --runInBand`                 | Jest unit suites beside source                            |
| `npm run test:e2e -- --runInBand`         | HTTP suites in `test/`                                    |
| `npm run test:cov`                        | Backend coverage report; no numeric threshold configured  |
| `npm audit --audit-level=high`            | Check lockfile dependencies for high/critical advisories  |

Examples of focused regressions:

```sh
npm test -- --runInBand src/files src/admin src/ai
npm run test:e2e -- --runInBand files.e2e-spec.ts admin.e2e-spec.ts ai.e2e-spec.ts
```

Jest and HTTP fixtures replace MongoDB and external providers. They still need
configuration validation values and may open local HTTP listeners; test setup
supplies synthetic settings. Passing them does not validate live transactions,
S3 cleanup, SMTP delivery, OAuth consent, Stripe collection or model providers.

## Frontend commands (`frontend/`)

```sh
npm run dev
```

This binds `127.0.0.1:3000`. In another terminal in the same directory:

```sh
npx playwright install chromium
npm run test:unit
npm test -- --grep-invert 'live\.spec\.js'
npm run build -- --webpack
npm audit --audit-level=high
```

Playwright uses `http://localhost:3000` and one worker. The command above excludes
`tests/live.spec.js`, whose tests make external public/staging API requests.
Run unfiltered `npm test` only when deliberately checking those integrations.
Most remaining browser tests intercept API requests; Node unit tests cover upload
safety helpers. Linux environments may also need Chromium system libraries.
Use `npm run start` to serve an already built frontend locally.

Frontend `npm run format` formats app/components/lib/tests and `.mjs` configuration.
It has no separate lint script or JavaScript ESLint configuration. The production
build includes its own compile checks; do not report a frontend lint pass based
on backend ESLint.

## Documentation formatting

From the repository root with dependencies installed:

```sh
npx prettier --check '*.md' 'docs/**/*.md' 'frontend/*.md'
```

Use `--write` for files you intentionally changed. Root `format:check` checks
TypeScript, not Markdown. Validate local Markdown targets/anchors and compare
all commands/variables with manifests and configuration after documentation edits.

## CI and safe collaboration

`.github/workflows/ci.yml` runs root dependency installation, formatting, ESLint,
build, complete unit/HTTP tests, and high/critical dependency advisories on
pushes and pull requests to `main`. It uses Node 24 and test substitutes; it does
not run frontend gates, build/publish Docker, or deploy. Frontend checks remain
required manual validation for frontend changes.

Read relevant guides and inspect existing implementations before editing. Run
`git status` and review the diff, preserve other contributors' work, and scope
commits by task. Add tests for meaningful changed behavior, particularly auth,
RBAC, tenancy, accounting and storage. Review dependency advisories in both
packages; do not blindly run `npm audit fix --force`. Report commands, results,
and unavailable/live checks accurately. Documentation-only edits need link,
command and formatting validation; they do not require rerunning application
suites when behavior is unchanged.

Privileged maintenance and smoke-test scripts are documented under [admin](admin.md),
not part of normal onboarding or automated unit checks. They can mutate the
selected database and require explicit authorization.
