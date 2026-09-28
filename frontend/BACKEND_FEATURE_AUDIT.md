# Backend/frontend feature audit — 2026-09-28

Compared the deployed OpenAPI schema and local backend controllers/services with the tenant frontend.

## Added in this update

AI Assistant is accessible to administrators and employees through the persistent lower-right chat widget; `/dashboard/assistant` redirects to the dashboard with chat open. It supports new conversations, follow-up messages, paginated private history, loading saved transcripts, and confirmed permanent deletion. All four documented `/ai` endpoints are forwarded by the allowlisted gateway. Disabled-service, message/conversation limits, busy, timeout, provider, authorization, and validation failures are handled without automatic message retries. Messages render as escaped plain text; there is no raw HTML injection. Drafts are retained after errors. The transcript is reloaded after successful sends to support the backend's recovered-commit response shape.

AI can answer general questions and use backend read-only tools for company profile, subscription/billing, company statistics, and authorized file metadata. It cannot change workspace data or read file contents. The frontend intentionally does not expose model selection, API keys, provider billing, tool internals, or backend configuration controls.

The handoff says `OPENROUTER_ENABLED=false`. The frontend cannot change Render configuration. The service administrator must enable OpenRouter, provide its API key, and configure its model on the backend. No provider credentials belong in frontend environment variables. There is no public capability endpoint to verify activation without an authenticated request. Live AI generation remains unverified without an activated test account.

## Backend capabilities without complete frontend controls

| Capability | Backend routes | Frontend status / reason |
| --- | --- | --- |
| Owner viewing/editing another employee’s profile | GET/PATCH /users/:id | Own profile is supported; employee-management page lists, invites, and deletes employees but does not offer employee detail/name-edit controls. |
| Upload/download/delete stored files | POST /files, GET /files/:id/download, DELETE /files/:id | Implemented but intentionally gated by NEXT_PUBLIC_STORAGE_ENABLED=false until S3 is configured. Metadata and permission editing are enabled. |
| Operational health display | GET /health/live, GET /health/ready | No dedicated service-status screen; these are operational endpoints, not required tenant product features. |
| Separate Platform Admin console | POST /admin/auth/login; GET /admin/dashboard, /admin/companies, /admin/companies/:id, /admin/users, /admin/files, /admin/audit-logs; POST /admin/companies/:id/suspend and /reactivate | Intentionally excluded from the tenant frontend and gateway. Requires separate Platform Admin credentials and product scope. Platform audit logs are not a tenant activity feed. |

Stripe's signed `/payments/webhook` is server-to-server functionality; it should not have a frontend control.

## Google OAuth frontend completed

Google OAuth is now integrated for existing accounts through direct browser navigation to the backend and `/auth/sign-in` fragment exchange. It shares email/password session handling, removes the code before exchange, and handles cancellation and exchange failures without automatic retries. The user reports Google is enabled on Render; the older handoff's disabled flag is historical. Unknown/inactive accounts and invalid browser state can return a backend callback error without a frontend redirect; no frontend page can intercept that response. Real Google account consent remains a manual production verification step; see README.

## Stripe frontend added

Owner billing now integrates all six tenant payment endpoints: current state, hosted Checkout setup, restricted Customer Portal, plan changes, cancellation, and explicit reconciliation. `/payments/success`, `/payments/cancel`, and `/payments/return` check server state; `/settings/billing` aliases the portal return page. Login preserves only these allowlisted return destinations. The gateway deliberately does not expose the webhook.

The deployed Swagger schema and local payment service describe **test mode only**. Checkout is `mode: setup`, returns `paymentCollected: false`, and saves a payment method rather than charging immediately. Pending plan changes, period-end cancellation, payment access, sync problems, and the latest ten invoices are shown separately from internal estimates. External links are restricted to the documented Stripe-hosted destinations. The frontend cannot enable Stripe or set Render return URLs. Live hosted checkout still requires the backend configuration and an activated test owner account.

Only the backend's exact disabled-service response enables the existing unpaid plan-assignment flow. Generic 503s do not fall back to assignment. Employee views never request owner payment endpoints. Reconciliation is user-triggered, not automatically retried or invoked merely by loading a return URL.

## Requested ideas that do not have backend endpoints

Email password recovery/reset, invitation company preview, tenant audit/activity feed, notifications, workspace switching, and editing an account/company email are not exposed. These cannot be completed by frontend wiring alone. Member access to the employee directory is prohibited; the member file-permission editor supports retaining/removing existing recipients and selecting oneself, while administrators have the searchable directory.

## Other integration prerequisite

Registration and employee activation pages are implemented, but email delivery and Render's activation/invitation URL configuration must work. A generic gateway 503 no longer falsely asserts email delivery failure: the saved-registration notice is limited to the backend's specific documented delivery-failure response.

