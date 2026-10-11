# Terms of Service

> **DRAFT — NOT EFFECTIVE. Owner/legal review required. Do not publish as a final policy or collect agreement to this draft.**
> Operator: **TODO: legal entity**. Effective date/version: **TODO**. Contact: **TODO: approved public contact**.

## Scope and operator

**TODO: insert approved contracting entity, address, service definition, effective date, eligibility/age, acceptance and change-notice rules.** These proposed terms concern hosted DataVault, not the open-source grant. [MIT](../../LICENSE) governs authorized original-source reuse; it does not provide an account, customer support, hosted service warranties, or rights in customer data. Third-party software has separate terms.

## Accounts and companies — implementation evidence

Email registration creates an inactive company/owner and sends an activation link; Google registration can create an activated company using verified email and supplied company details. Companies have owners/members; owners manage invitations, employees and plans. Platform administrators have separate identities and metadata access, not tenant file-download authority. Account/company status and API authorization enforce access on subsequent requests. See [security](../security.md) and [admin](../admin.md).

**TODO: approve customer authority to represent its organization, accurate registration details, account security duties, invitation authorization, prohibited account sharing, and support/recovery procedure.** Do not promise account deletion by a self-service control: a general company/account closure workflow is not implemented.

## Customer files and data — proposed allocation

**TODO: approve clause confirming customer ownership and only the limited rights necessary to store, transmit, display, secure, and process data on customer instructions.** Uploading data does not place it under MIT. Customers must have lawful rights to upload/share data; prohibited-data categories and regulated-data support require owner/legal decisions in [acceptable use](ACCEPTABLE_USE_POLICY.md).

The service currently validates CSV/XLS/XLSX structure and stores objects privately in configured S3 with company-scoped metadata. Visibility is company-wide or restricted; company owners and uploaders retain applicable access. It does not implement Sensitive Data Guard, guaranteed PII detection, redaction, or malware scanning. File deletion and database/storage reconciliation have documented failure limitations; see [retention](DATA_RETENTION.md).

## AI and external processing

When enabled, assistant prompts, bounded chat history and minimized read-only tool results go to configured providers: OpenRouter/downstream models, or direct Gemini for eligible fallback/standalone operation. Tools do not inspect uploaded file contents; users can nevertheless paste sensitive information into a prompt. AI answers may be inaccurate and require review. Local Stop waiting does not cancel backend processing. See [AI](../ai.md), [privacy](PRIVACY_POLICY.md), and [provider review](SUBPROCESSORS.md).

**TODO: approve AI-use restrictions, appropriate disclosures/authorization, model allowlists, processing contracts and retention choices.** Do not promise zero retention or that all AI processing stays in the tenant's country.

## Billing, cancellation and refunds

Implementation currently supports internal plan/usage estimates and **Stripe Test Mode only**; estimates are not collected revenue or invoices. Owner-only hosted Checkout/Portal, scheduled changes and cancellation use server/provider state. Company suspension does not automatically cancel subscriptions. See [billing](../billing.md).

**TODO: approve commercial pricing/currency/taxes, renewal notices, cancellation timing, trial rules, refunds/credits, failed-payment consequences and dispute handling.** No refund API or adopted refund policy was found; do not turn internal/test prices into a binding paid-service offer. Live billing needs a separately approved implementation and operational verification.

## Availability, enforcement and liability

**TODO: approve availability/support commitments, maintenance notices, acceptable-use enforcement, suspension/termination grounds, customer export opportunity, and post-termination data handling.** Current platform suspension restricts tenant access but does not erase data or stop billing synchronization. No SLA or backup/restore guarantee is established by code.

**TODO: counsel supplies service warranties/disclaimers, liability allocation, indemnities if appropriate, governing law and dispute procedure.** The source-code MIT disclaimer remains unchanged and is not a substitute for hosted-service terms. Incident communications and contact paths must be approved alongside [privacy](PRIVACY_POLICY.md); no notification deadline is promised by this draft.
