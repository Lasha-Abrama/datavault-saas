# Documentation index

Reviewed against repository code on 2026-10-11. Begin with the [project README](../README.md).

| Need                                            | Canonical guide                                                  |
| ----------------------------------------------- | ---------------------------------------------------------------- |
| Understand backend/frontend boundaries          | [Architecture](architecture.md)                                  |
| Set up local apps and run checks                | [Development and testing](development.md)                        |
| Find settings, defaults and required groups     | [Environment reference](environment.md)                          |
| Deploy the API and frontend                     | [Render/Vercel operations](deployment.md)                        |
| Configure SMTP/Brevo or Resend                  | [Transactional email](environment.md#transactional-email)        |
| Configure Google OAuth                          | [Google settings and flow](environment.md#optional-google-oauth) |
| Understand authentication, tenants and files    | [Security](security.md)                                          |
| Work on admin identity and privileged CLI tools | [Platform administration](admin.md)                              |
| Work on estimates, entitlements and Stripe      | [Billing](billing.md)                                            |
| Work on the assistant, tools and fallback       | [AI](ai.md)                                                      |
| Verify routes, statuses and Swagger conventions | [API](api.md)                                                    |
| Resolve setup failures                          | [Troubleshooting](troubleshooting.md)                            |
| Check completed work and remaining release gaps | [Stabilization roadmap](stabilization-roadmap.md)                |

Configuration authority is `src/config/environment.ts`, feature code, and the
placeholder-only environment templates. Package manifests define runnable
scripts; controllers/DTOs and generated Swagger define the API contract.
Update the relevant guide when changing those sources. Avoid copying complete
contracts into several READMEs.

[Frontend README](../frontend/README.md) is the frontend entry point.
[Frontend handoff](../FRONTEND_HANDOFF.md) and [feature audit](../frontend/BACKEND_FEATURE_AUDIT.md)
contain dated integration context; deployment state must be checked separately.
Earlier live checks are evidence about their recorded date, not current health.
Sensitive Data Guard requires architecture/security review before implementation.
