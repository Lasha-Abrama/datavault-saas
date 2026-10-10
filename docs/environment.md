# Environment reference

[Documentation index](README.md). Validated by [`src/config/environment.ts`](../src/config/environment.ts); CLI bootstrap validation is separate. Templates: [backend](../.env.example), [frontend](../frontend/.env.example). Blank examples are not a ready-to-run environment.

Set configuration in the deployment environment or secret manager; never bake `.env` files into an image. The repository ignores all `.env*` files except the placeholder-only `.env.example`.

### MongoDB

| Variable                            | Required | Purpose                                                                                                                         |
| ----------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `MONGO_URI`                         | Yes      | MongoDB Atlas or another replica-set/sharded-cluster URI. Include the database name and TLS options required by the deployment. |
| `MONGO_SERVER_SELECTION_TIMEOUT_MS` | No       | Driver server-selection timeout; defaults to 10,000 ms.                                                                         |
| `MONGO_MAX_POOL_SIZE`               | No       | Per-process connection-pool maximum; defaults to 20. Size the aggregate across all replicas.                                    |
| `MONGO_RETRY_ATTEMPTS`              | No       | Nest startup connection attempts; defaults to 5.                                                                                |
| `MONGO_RETRY_DELAY_MS`              | No       | Delay between startup attempts; defaults to 3,000 ms.                                                                           |

Transactions are mandatory. Company registration, invitation acceptance, employee-seat reservation, plan changes, and upload quota/metadata accounting rely on multi-document transactions. A standalone MongoDB is unsupported. Startup executes MongoDB's `hello` command and refuses to serve traffic unless logical sessions and either a replica set or sharded cluster are present. It also waits for registered Mongoose model indexes, including uniqueness constraints, before serving HTTP. Initial connection or index failures stop startup; operations never fall back to non-transactional writes.

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

### Transactional email

`EMAIL_PROVIDER` is required and must be `smtp` or `resend`; the choice is independent of `NODE_ENV`. Auth and invitation services create the same plaintext activation/invitation messages and links through one sender interface. Exactly one provider handles each attempt; there is no automatic fallback or cross-provider retry.

| Variable                     | Required when              | Purpose                                                            |
| ---------------------------- | -------------------------- | ------------------------------------------------------------------ |
| `SMTP_HOST`                  | `EMAIL_PROVIDER=smtp`      | SMTP hostname or IP address.                                       |
| `SMTP_FROM`                  | `EMAIL_PROVIDER=smtp`      | Plain sender email address.                                        |
| `SMTP_PORT`                  | Optional in SMTP mode      | Defaults to 587, or 465 when implicit TLS is enabled.              |
| `SMTP_SECURE`                | Optional in SMTP mode      | `true` for implicit TLS, normally port 465; defaults to `false`.   |
| `SMTP_REQUIRE_TLS`           | Optional in SMTP mode      | Requires STARTTLS when not using implicit TLS; defaults to `true`. |
| `SMTP_USER`, `SMTP_PASSWORD` | Optional pair in SMTP mode | Configure both or neither.                                         |
| `RESEND_API_KEY`             | `EMAIL_PROVIDER=resend`    | Backend-only Resend API key, stored as a deployment secret.        |
| `RESEND_FROM`                | `EMAIL_PROVIDER=resend`    | Plain email address on a verified Resend sender domain.            |

Local development can keep Nodemailer/Gmail with `EMAIL_PROVIDER=smtp`. SMTP connection, greeting, and socket timeouts are bounded; Nodemailer file and URL access are disabled. **[Render Free blocks outbound SMTP ports 25, 465, and 587](https://render.com/docs/free)**, so the Gmail SMTP path is not suitable there. Brevo supports SMTP on port 2525, which the existing SMTP sender can use without code changes. For a Render deployment without a sending domain, create and verify a Brevo sender, enable transactional sending, and set these backend environment variables:

```env
EMAIL_PROVIDER=smtp
SMTP_HOST=smtp-relay.brevo.com
SMTP_PORT=2525
SMTP_SECURE=false
SMTP_REQUIRE_TLS=true
SMTP_FROM=<verified sender email>
SMTP_USER=<Brevo SMTP login>
SMTP_PASSWORD=<Brevo SMTP key>
```

Get the SMTP login and key from Brevo's SMTP settings; the key is different from its API key. Keep the key in Render's environment, never in source control or frontend variables. Brevo may replace a sender on a free mailbox domain with its own address, and delivery still depends on account approval and receiving mailboxes. Test activation and invitation delivery to separate real inboxes before opening registration. A signup whose activation email failed is already saved: use `/auth/resend-verification` or the frontend's **Resend activation** form after fixing delivery, rather than registering the same address again. See [Brevo SMTP setup](https://help.brevo.com/hc/en-us/articles/7924908994450-Send-transactional-emails-using-Brevo-SMTP), [port 2525](https://help.brevo.com/hc/en-us/articles/10905415650322-Which-SMTP-port-should-I-use-Port-587-465-or-2525), and [sender handling](https://help.brevo.com/hc/en-us/articles/14925263522578-Comply-with-Gmail-Yahoo-and-Microsoft-s-requirements-for-email-senders).

Alternatively, verify a sending domain in Resend, create a send-only API key, set `EMAIL_PROVIDER=resend`, `RESEND_API_KEY`, and `RESEND_FROM` in Render, and omit SMTP variables. Resend delivery uses HTTPS with a 10-second timeout; provider errors and response bodies are never forwarded to clients or logged. Both frontend application URLs remain required and provider-independent.

Registration commits the inactive company, owner, Free subscription, and verification record before requesting delivery. If delivery fails, signup returns a sanitized 503 even though registration was saved; resend-verification remains available. Invitation creation similarly commits the pending invitation before delivery, then returns a sanitized 503 if sending fails; the owner can resend it later. These semantics do not depend on the selected provider.

### Email workflows and recovery

Activation and activation resend use `ACCOUNT_ACTIVATION_URL`; employee invitations and invitation resend use `EMPLOYEE_INVITATION_URL`. Workspace password recovery constructs `/reset-password` on the activation URL's origin and places the one-use token in the URL fragment. Platform recovery and access-request verification/password setup use `/admin` on that same origin. Keep those frontend routes deployed; there is no separate password-reset URL environment variable.

Workspace and platform forgot-password endpoints return generic responses to reduce account enumeration. Reset links expire after 30 minutes; reset completion revokes earlier sessions using the authentication version. Delivery failures are sanitized and must not expose provider responses or tokens. Platform access requests require verified email and an administrator's decision before access is granted; approval notification delivery is a separate outcome.

For an explicitly authorized mailbox check, use disposable accounts to exercise signup, activation, resend, invitation acceptance/resend, workspace recovery, and platform recovery/setup. Check link origin, expiry/reuse, session invalidation, and delivery failure recovery. Do not log tokens or claim live inbox delivery from a mocked sender test. See [development](development.md) and [admin operations](admin.md).

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

Leaving all four Google variables blank disables Google OAuth. The browser navigates to `GET /auth/google`. The backend stores hashed, single-use state in MongoDB and binds it to an HttpOnly, SameSite=Lax cookie. On HTTPS it uses a host-only `__Host-` cookie (Secure, `Path=/`); localhost HTTP development uses a callback-path-scoped cookie. After Google verifies the email, existing active users return to `/auth/sign-in#code=...` and exchange the one-minute code through `POST /auth/google/exchange`. New users return to `/register#google_code=...`, enter company name, country, and industry, then call `POST /auth/google/register`. This creates an activated company, owner, and Free subscription atomically; no password or activation email is needed. The five-minute registration code is consumed in that transaction, so a failed company-name attempt can be corrected before expiry. Both frontend pages immediately remove codes from browser history. Use HTTPS for both origins in production, register the exact backend callback with Google, allow the frontend origin in `CORS_ORIGIN`, and share one MongoDB database across backend instances. Google initiation, callback, and exchange reject non-HTTPS requests in production; behind TLS termination, set `TRUST_PROXY_HOPS` to the exact trusted proxy count and keep the listener private. Do not log exchange codes or include them in analytics.

### Optional AI providers: OpenRouter primary, direct Gemini fallback

The AI assistant is disabled by default. OpenRouter remains primary, including its configured model-level fallback routing. If its first model round fails with HTTP 429, a provider/network timeout, or an eligible 5xx/unavailable error, and Gemini is enabled, the backend tries Google's direct Gemini API once. A successful first round pins that provider for the rest of the current tool exchange, preserving its function-call history; the next user turn starts with OpenRouter again. Invalid responses, authentication/credit errors, 4xx configuration errors and local application failures do not trigger provider fallback. Gemini can also run alone when OpenRouter is disabled. Browser clients cannot provide model IDs, token budgets, usage, prices, tenant IDs, or tool authorization context.

| Variable                         | Required when enabled | Purpose                                                                                                |
| -------------------------------- | --------------------- | ------------------------------------------------------------------------------------------------------ |
| `OPENROUTER_ENABLED`             | No                    | Explicit opt-in; defaults to `false`.                                                                  |
| `OPENROUTER_API_KEY`             | Yes                   | Backend-only OpenRouter key. Store in a secret manager.                                                |
| `OPENROUTER_MODEL`               | Yes                   | Server-controlled primary `provider/model` ID. Select a model that supports OpenAI-compatible tools.   |
| `OPENROUTER_FALLBACK_MODELS`     | No                    | Up to three distinct, comma-separated, tool-capable fallback model IDs in routing order.               |
| `OPENROUTER_TIMEOUT_MS`          | No                    | Complete request timeout per provider round; defaults to 30 seconds, range 5–120 seconds.              |
| `OPENROUTER_MAX_OUTPUT_TOKENS`   | No                    | Output-token ceiling for each model round; defaults to 1,000, range 64–8,192.                          |
| `OPENROUTER_MAX_TOOL_ITERATIONS` | No                    | Sequential read-only tool-call ceiling; defaults to 3, range 1–5.                                      |
| `OPENROUTER_REQUIRE_ZDR`         | No                    | Requests Zero Data Retention-compatible routing when `true`; use only with eligible configured models. |
| `GEMINI_ENABLED`                 | No                    | Explicit opt-in for direct Gemini; defaults to `false`.                                                |
| `GEMINI_API_KEY`                 | Yes, for Gemini       | Backend-only Google AI Studio API key. Store in a secret manager.                                      |
| `GEMINI_MODEL`                   | Yes, for Gemini       | Server-controlled direct Gemini model ID with function calling.                                        |
| `GEMINI_TIMEOUT_MS`              | No                    | Direct Gemini call timeout; defaults to 30 seconds, range 5–120 seconds.                               |
| `GEMINI_MAX_OUTPUT_TOKENS`       | No                    | Direct Gemini completion ceiling; defaults to 2,048, range 64–8,192.                                   |
| `AI_MAX_MESSAGE_CHARS`           | No                    | Maximum user message length; defaults to 8,000.                                                        |
| `AI_MAX_HISTORY_MESSAGES`        | No                    | Recent persisted messages eligible for one context; defaults to 20.                                    |
| `AI_MAX_CONTEXT_CHARS`           | No                    | Character ceiling for persisted history supplied to a request; defaults to 40,000.                     |
| `AI_MAX_CONVERSATION_MESSAGES`   | No                    | Stored user-visible messages per conversation; defaults to 100.                                        |
| `AI_MAX_CONVERSATIONS_PER_USER`  | No                    | Stored conversations per tenant user; defaults to 100.                                                 |
| `AI_RATE_LIMIT_PER_MINUTE`       | No                    | AI chat requests per authenticated company/user tracker; defaults to 10.                               |

OpenRouter and its selected downstream provider receive each submitted prompt, bounded user-visible conversation context, the system instruction and, when needed, minimized read-only tool results. When direct Gemini is used, Google receives that same necessary context. Gemini is accessed through Google's officially supported OpenAI-compatible endpoint using the existing OpenAI SDK; this preserves tool-call history, including opaque Gemini thought signatures, without sending requests through OpenRouter. The backend never enables Google Search or other provider-hosted tools. Choose a currently available model supporting the configured function-calling interface; availability, quota and free-tier eligibility depend on the Google project. The free tier may permit provider data use, so review Google AI Studio billing and data-use settings before enabling it with production tenant data. Do not promise zero retention unless every selected provider's policy and configuration have been verified. Review provider terms, budgets, model allowlists and privacy policy before enabling production traffic. Provider/model and token counts are recorded internally; Gemini cost remains unknown unless Google reliably reports it (no price is fabricated). The API response shape is unchanged.

For local testing, put `GEMINI_ENABLED=true`, `GEMINI_MODEL=<tool-capable model ID>`, and your private `GEMINI_API_KEY` only in the ignored local `.env`; keep the existing `OPENROUTER_*` values to test primary-first routing. For Render, add the same names in the service's private environment settings, keep `OPENROUTER_ENABLED=true` for primary routing, and redeploy after reviewing Google project quotas, billing and data-use policy. Keep the key out of `NEXT_PUBLIC_*` variables and never add it to Swagger or frontend requests. Set `GEMINI_ENABLED=false` to restore OpenRouter-only operation. If both provider flags are false, `/ai/chat` returns the existing `ai_disabled` response.

## Stripe Test Mode

| Variable                                                                                | Required when enabled | Purpose                                                                                                                                                                                    |
| --------------------------------------------------------------------------------------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `STRIPE_ENABLED`                                                                        | No                    | Opt-in boolean, defaults to `false`.                                                                                                                                                       |
| `STRIPE_SECRET_KEY`                                                                     | Yes                   | Test secret key (`sk_test_…`), backend/secret manager only.                                                                                                                                |
| `STRIPE_WEBHOOK_SECRET`                                                                 | Yes                   | Endpoint signing secret (`whsec_…`); local CLI and deployed endpoint secrets differ.                                                                                                       |
| `STRIPE_BASIC_PRICE_ID`, `STRIPE_PREMIUM_PRICE_ID`, `STRIPE_OVERAGE_PRICE_ID`           | Yes                   | Three distinct Test Mode Prices matching the catalog documented in billing.md.                                                                                                             |
| `STRIPE_OVERAGE_METER_ID`, `STRIPE_OVERAGE_EVENT_NAME`                                  | Yes                   | Sum meter and its event name.                                                                                                                                                              |
| `STRIPE_PORTAL_CONFIGURATION_ID`                                                        | Yes                   | Test Mode portal configuration without plan/cancel controls.                                                                                                                               |
| `STRIPE_CHECKOUT_SUCCESS_URL`, `STRIPE_CHECKOUT_CANCEL_URL`, `STRIPE_PORTAL_RETURN_URL` | Yes                   | Server-configured frontend destinations. HTTPS outside localhost; HTTPS everywhere in production. No URLs are accepted from the client.                                                    |
| `STRIPE_SYNC_INTERVAL_MS`                                                               | No                    | Mongo-backed reconciliation polling, defaults to 30 seconds (10–300 seconds). Run at least one long-lived Nest process; serverless-only request execution cannot run this worker reliably. |

See [billing operations](billing.md) for catalog validation and accounting.

## Platform admin bootstrap

| Variable                             | Purpose                                                                                                                       |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| `MONGO_URI`                          | Intended transactional MongoDB database.                                                                                      |
| `PLATFORM_ADMIN_BOOTSTRAP_EMAIL`     | Explicit administrator email; normalized to lowercase.                                                                        |
| `PLATFORM_ADMIN_BOOTSTRAP_FULL_NAME` | Explicit display name, 2–100 characters.                                                                                      |
| `PLATFORM_ADMIN_BOOTSTRAP_PASSWORD`  | At least 12 characters, at most 72 UTF-8 bytes; uppercase, lowercase, digit and non-whitespace special character. No default. |

These variables are CLI-only, not normal application runtime requirements. Read [admin operations](admin.md#bootstrap-and-authentication) before running privileged tools.

## Frontend

`NEXT_PUBLIC_API_URL` is the only application setting in `frontend/.env.example`. It is a public backend base URL without an `/api` prefix, credentials, or query string. For local development use `http://localhost:3001`; deployments use an HTTPS API origin. It is read by the gateway and Google browser navigation. Rebuild/restart the frontend after changing it; never put backend secrets in `NEXT_PUBLIC_*`. Frontend `.env.local` is separate from the backend `.env`.
