# Backend/frontend feature audit — 2026-09-26

Compared the deployed OpenAPI schema and local backend controllers/services with the tenant frontend.

## Added in this update

AI Assistant is accessible to administrators and employees through the persistent lower-right chat widget; `/dashboard/assistant` redirects to the dashboard with chat open. It supports new conversations, follow-up messages, paginated private history, loading saved transcripts, and confirmed permanent deletion. All four documented `/ai` endpoints are forwarded by the allowlisted gateway. Disabled-service, message/conversation limits, busy, timeout, provider, authorization, and validation failures are handled without automatic message retries. Messages render as escaped plain text; there is no raw HTML injection. Drafts are retained after errors. The transcript is reloaded after successful sends to support the backend's recovered-commit response shape.

AI can answer general questions and use backend read-only tools for company profile, subscription/billing, company statistics, and authorized file metadata. It cannot change workspace data or read file contents. The frontend intentionally does not expose model selection, API keys, provider billing, tool internals, or backend configuration controls.

The handoff says `OPENROUTER_ENABLED=false`. The frontend cannot change Render configuration. The service administrator must enable OpenRouter, provide its API key, and configure its model on the backend. No provider credentials belong in frontend environment variables. There is no public capability endpoint to verify activation without an authenticated request. Live AI generation remains unverified without an activated test account.

## Backend capabilities without complete frontend controls

| Capability | Backend routes | Frontend status / reason |
| --- | --- | --- |
| Google OAuth | GET /auth/google, GET /auth/google/callback, POST /auth/google/exchange | Not integrated; Google OAuth is unconfigured according to the handoff. Needs browser-bound start, callback/code exchange, and error handling. |
| Stripe Checkout and customer portal | POST /payments/checkout, POST /payments/portal | Not integrated; explicitly excluded from the original brief and Stripe disabled in the handoff. |
| Stripe subscription/invoice status and reconciliation | GET /payments/current, POST /payments/plan, POST /payments/cancel, POST /payments/reconcile | Not integrated; existing Billing is the internal estimate and assignment-mode plan change, not Stripe payment state. |
| Owner viewing/editing another employee’s profile | GET/PATCH /users/:id | Own profile is supported; employee-management page lists, invites, and deletes employees but does not offer employee detail/name-edit controls. |
| Upload/download/delete stored files | POST /files, GET /files/:id/download, DELETE /files/:id | Implemented but intentionally gated by NEXT_PUBLIC_STORAGE_ENABLED=false until S3 is configured. Metadata and permission editing are enabled. |
| Operational health display | GET /health/live, GET /health/ready | No dedicated service-status screen; these are operational endpoints, not required tenant product features. |
| Separate Platform Admin console | POST /admin/auth/login; GET /admin/dashboard, /admin/companies, /admin/companies/:id, /admin/users, /admin/files, /admin/audit-logs; POST /admin/companies/:id/suspend and /reactivate | Intentionally excluded from the tenant frontend and gateway. Requires separate Platform Admin credentials and product scope. Platform audit logs are not a tenant activity feed. |

Stripe's signed `/payments/webhook` is server-to-server functionality; it should not have a frontend control.

## Requested ideas that do not have backend endpoints

Email password recovery/reset, invitation company preview, tenant audit/activity feed, notifications, workspace switching, and editing an account/company email are not exposed. These cannot be completed by frontend wiring alone. Member access to the employee directory is prohibited; the member file-permission editor supports retaining/removing existing recipients and selecting oneself, while administrators have the searchable directory.

## Other integration prerequisite

Registration and employee activation pages are implemented, but email delivery and Render's activation/invitation URL configuration must work. A generic gateway 503 no longer falsely asserts email delivery failure: the saved-registration notice is limited to the backend's specific documented delivery-failure response.

