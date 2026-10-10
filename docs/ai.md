# AI providers and assistant

[Documentation index](README.md). Provider settings and fallback eligibility are in [the environment reference](environment.md#optional-ai-providers-openrouter-primary-direct-gemini-fallback).

The optional `src/ai` module provides a general conversational assistant for activated tenant owners and members. Ordinary programming, writing, explanation, brainstorming and business questions go through the configured language model. DataVault account questions use a bounded server-side tool loop so account facts come from existing authoritative services.

### API and conversation lifecycle

All routes require a tenant JWT, reject platform-admin JWTs, return `Cache-Control: private, no-store`, and derive company/user ownership from the authenticated request:

| Endpoint                       | Input/behavior                                                                                                                                                   |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /ai/chat`                | `{ "message": "…", "conversationId"?: "…" }`; creates a conversation when the ID is omitted or appends one user/assistant exchange to the caller's conversation. |
| `GET /ai/conversations`        | Lists only the caller's conversations with bounded `page`/`limit`; content is not duplicated in list results.                                                    |
| `GET /ai/conversations/:id`    | Returns the caller's conversation and its user-visible user/assistant messages in order.                                                                         |
| `DELETE /ai/conversations/:id` | Hard-deletes the caller's conversation and message content. Content-free usage records remain for aggregate cost/operations reporting.                           |

Conversation, message and usage documents carry immutable `companyId` and `userId` references. Every lookup and mutation includes both references; another user in the same company and every other tenant receive the same non-enumerating 404. One expiring database lease serializes requests for a conversation. The final exchange and usage record commit together in a MongoDB transaction, with a unique server-generated request ID supporting safe uncertain-commit recovery. History is bounded by message and character limits, each conversation has a stored-message ceiling, and user conversation counts are bounded.

The usage collection stores only model names, input/output/total tokens, duration, tool-call count and provider cost converted to integer micro-USD when OpenRouter reliably returns it. Values come only from provider responses and server timing. It does not copy prompts, completions or tool results. AI usage is operational metadata only; it does not change DataVault plans, Stripe billing, employee seats, file quotas, or the assignment billing estimate.

### Read-only DataVault tools

The model can request exactly these tools:

- `get_company_profile` — safe company name, country, industry, activation date and caller role.
- `get_subscription_and_billing` — current plan/entitlements, activation-anchored period, accepted employee count and existing DataVault billing estimate.
- `get_company_statistics` — the existing tenant dashboard composition for employees, pending invitations, stored files, upload usage and limits.
- `list_visible_files` — up to 10 recent metadata records after the existing owner/member/uploader/restricted-file authorization rules; no storage key, internal IDs, URL, credentials or file content.

Tool arguments are strict JSON and never accept tenant/user IDs. Unknown or repeated calls, oversized arguments and iteration overflow fail closed. The model proposes calls but never authorizes them: tool services receive the current server-authenticated actor and reuse existing tenant-aware services. Tools cannot write data, access platform administration, query arbitrary MongoDB data, run code/shell commands, fetch URLs, inspect S3 objects, call Stripe, or expose private spreadsheet/CSV contents.

The system instruction treats prompts and tool data as untrusted and forbids disclosure of hidden instructions, schemas, raw tool payloads, credentials, internal identifiers and other tenants. Technical isolation does not depend on the model following that instruction. Request logs contain a random correlation ID and safe usage/timing fields, never prompt/completion/tool content or provider credentials. Provider authentication, credit, rate-limit, timeout, malformed-response and 5xx failures map to sanitized application errors.

This first version returns an atomic JSON response. SSE streaming is intentionally deferred: persisting one complete exchange, applying tool limits and returning one safe provider error are more reliable than exposing partial output before the transaction commits. The controller/client boundary and model client interface leave a clean extension point for a separately designed streaming protocol.

Automated tests replace the model client and make no OpenRouter or Gemini calls. For one deliberate local provider test after adding your own key:

1. In OpenRouter, create a restricted development key with a small credit/budget limit. Review the selected models' tool support and provider privacy/retention policy; configure account model/provider allowlists as needed.
2. Put the key only in the ignored local `.env`. Set `OPENROUTER_ENABLED=true`, `OPENROUTER_API_KEY`, a tool-capable `OPENROUTER_MODEL`, and optional tool-capable fallbacks. Keep output, timeout and iteration limits small. Set `OPENROUTER_REQUIRE_ZDR=true` only after confirming eligible routing.
3. Build and start the backend. Sign in as an activated disposable test-tenant user through your local API client. Keep the tenant JWT in that client's private authorization store rather than source, shell history or saved shared requests.
4. Send `POST /ai/chat` with `{ "message": "Explain dependency injection in one paragraph." }`. Confirm a normal answer, bounded server-reported usage and no secret/provider details in the response or logs.
5. Reuse the returned conversation ID with a follow-up, then ask a DataVault question such as `What is my current file allowance?` to exercise an authoritative tool. Do not include secrets or private file contents in prompts.
6. Retrieve and delete the disposable conversation through the routes above. Set `OPENROUTER_ENABLED=false`, restart, and revoke the temporary key when testing is complete.

## Waiting, interruption, and privacy

The shared assistant workspace runs in the floating chat; `/dashboard/assistant`
redirects to `/dashboard?assistant=open`. Sending immediately shows an animated
waiting indicator with a separate polite live region. After 15 seconds the label
says it is still waiting, not that a particular tool or model stage has started.
Reduced motion uses static dots; minimizing pauses the indicator. History and
multiline response rendering are preserved.

“Stop waiting” aborts locally, retains the draft, and offers history refresh.
The backend may still finish and account for the request. Client/gateway waiting
is bounded to 90 seconds; configured provider deadlines can exceed that, so
check history before manually resending an interrupted request. There are no
automatic chat retries or invented chain-of-thought messages.

OpenRouter primary and direct Gemini fallback both remain non-streaming.
Fallback is limited to an eligible first-round failure, and the chosen provider
is pinned through that turn's tool continuation. No frontend model selection,
private reasoning, API keys, raw tool arguments, or sensitive file content are
exposed. AI usage records do not alter product billing or file/seat quotas.
Streaming requires a separately reviewed backend design; see [Task 4's
investigation](stabilization-roadmap.md#streaming-investigation).
