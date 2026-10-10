# Render and Vercel operations

[Documentation index](README.md). These are configuration instructions, not a
claim that any existing service currently matches them. There is no checked-in
Render Blueprint or Vercel deployment manifest. Review dashboard settings for
the intended revision and environment before an explicitly authorized release.

## Nest API on Render

Use a Node Web Service with repository root as its root directory and Node 24.
Set build command `npm ci && npm run build` and start command
`npm run start:prod`. Keep development dependencies available during the build.
Nest binds `0.0.0.0` and reads Render's `PORT`. Configure backend values privately
from [the environment reference](environment.md); set `NODE_ENV=production`.
Never bake an `.env` into a build or image. These commands follow Render's
[Node web-service deployment model](https://render.com/docs/deploy-node-express-app).

MongoDB must be a replica set/sharded cluster with logical sessions; startup
checks it and awaits model indexes. Verify database network access, permissions,
TLS and pool sizing across replicas. The durable Stripe worker requires a
long-lived process, not request-only serverless execution.

Use `/health/ready` for dependency-aware readiness: it pings MongoDB and returns
503 on failure. `/health/live` reports only process liveness. Neither probe
certifies S3, email, billing, or AI availability. Shutdown hooks close resources.
Configure `TRUST_PROXY_HOPS` only after verifying the actual proxy chain, and
keep the origin listener behind the expected network path. Do not assume a
universal hop count; Google production routes require correctly recognized HTTPS.

[Render Free limitations](https://render.com/docs/free) include idle spin-down
and outbound SMTP restrictions on ports 25, 465 and 587. Cold starts can exceed
client waiting limits, and a sleeping service cannot continuously reconcile
billing. Use a suitable always-running deployment for operational billing.
For Brevo, the existing sender supports port 2525 with STARTTLS; see [email
configuration](environment.md#transactional-email) and [Brevo's port guidance](https://help.brevo.com/hc/en-us/articles/10905415650322-Which-SMTP-port-should-I-use-Port-587-465-or-2525).
Delivery still needs sender/account approval and an authorized mailbox check.

## Next.js on Vercel

Import the repository with project root `frontend/` and the Next.js framework
preset. Install with `npm ci`; the locally verified production command is
`npm run build -- --webpack`. There is no static-export configuration: the
`/backend` Node route requires a server runtime. Configure only the public
`NEXT_PUBLIC_API_URL=https://api.example.invalid` for the intended API, without
an `/api` prefix. Configure each intended preview/production environment and
rebuild after changing the URL. Never add MongoDB, email, S3, Stripe or AI secrets
to frontend variables. See [Next.js on Vercel](https://vercel.com/docs/frameworks/full-stack/nextjs).

The gateway forwards allowlisted requests and body streams with a 90-second
upstream deadline. Check actual hosting function duration and body-size limits
before claiming a configured backend upload size or AI deadline works end to
end. The API permits buffered files up to its configured limit; that is not a
promise that every proxy accepts the same size.

## Cross-service routing

Use the real frontend HTTPS origin for backend `ACCOUNT_ACTIVATION_URL`
(`/activate`) and `EMPLOYEE_INVITATION_URL` (`/employee-activate`). Their origin
also hosts tenant/admin recovery pages. Google requires all four settings and
the exact direct API `/auth/google/callback` registered with Google. The browser
starts OAuth directly; the gateway does not forward its state cookie.

Same-origin gateway traffic does not need browser CORS at the API. Direct
browser API clients need exact allowed `CORS_ORIGIN` values; preview origins are
not automatically trusted. Keep both deployed origins HTTPS. Stripe webhook
`/payments/webhook` is registered directly on the API with its endpoint's Test
Mode signing secret and supported events; it is not a Vercel gateway route.
Payment return URLs are server-configured frontend paths, not payment evidence.

## Docker alternative and release checks

The root multi-stage Dockerfile builds with Node 24, prunes development
dependencies, and runs as unprivileged `node`. CI does not build/publish it.
For an explicitly authorized local container check with privately configured
`.env` and Docker installed:

```sh
docker build -t datavault-saas .
docker run --env-file .env -p 3001:3000 -e PORT=3000 datavault-saas
```

Validate formatting, lint, builds, relevant tests and both dependency audits at
the release revision. Then separately verify readiness, tenant/admin separation,
private upload/download/delete and compensation, activation/invitation/recovery
mail delivery, Google consent, Stripe Test Mode webhooks/reconciliation and
provider/tool fallback with disposable authorized fixtures. Use [admin maintenance](admin.md)
only after reviewing its target and permissions. Do not auto-delete smoke-test
fixtures or audit/outbox history.

Database/storage backups, restore drills, query performance, monitoring and
provider privacy/retention review remain operational responsibilities. No
production deployment or live integration check was performed by this
documentation update.
