# Privacy Policy

> **DRAFT — NOT EFFECTIVE. Owner/legal review required. Do not publish as a final policy or collect agreement to this draft.**
> Operator: **TODO: legal entity**. Effective date/version: **TODO**. Contact: **TODO: approved public contact**.

## Operator, roles and applicability

**TODO: identify operator/controller, privacy contact, customers' controller/processor roles, lawful bases, jurisdictions, rights and DPA arrangements.** This draft covers personal information used to operate hosted DataVault and personal information customers put into service data. MIT licenses authorized original repository code; it grants no rights over customer files or personal information.

## Processing inventory — implementation evidence

| Information                                                                                                   | Implemented purpose / storage                                                                             | Evidence                                                                                |
| ------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Name, email, password hash, company name/country/industry, role/company references, status and timestamps     | Registration, sign-in, activation, employee management and authorization in MongoDB                       | [Auth](../../src/auth/auth.service.ts), [security](../security.md)                      |
| Verification/invitation/reset hashes and expiry fields; OAuth state/exchange records                          | One-use activation, recovery, invitations and Google completion; transactional delivery uses the raw link | [Email settings](../environment.md#transactional-email), [retention](DATA_RETENTION.md) |
| Uploaded CSV/XLS/XLSX content and file name/type/size, uploader/company, visibility/recipients and timestamps | Private configured object storage and authorization/accounting metadata in MongoDB                        | [Files](../../src/files/files.service.ts)                                               |
| Chat messages/history and conversation ownership                                                              | Assistant responses and stored history; configured external processing                                    | [AI](../ai.md)                                                                          |
| Model/provider, user/company/conversation references, token counts, duration, tool counts and available cost  | Content-free AI usage records; not anonymous and not product billing                                      | [AI usage schema](../../src/ai/entities/ai-usage.entity.ts)                             |
| Subscription/usage, Stripe mappings/operations/events and synchronization state                               | Internal estimates and optional Stripe Test Mode reconciliation                                           | [Billing](../billing.md)                                                                |
| Platform identities, access requests and audit actor/target/action records                                    | Separate platform authorization, request review and administrative accountability                         | [Admin](../admin.md)                                                                    |

Hosting/network providers and support tools may process technical request data independently of application records. **TODO: verify deployed logs, IP/device collection, telemetry, analytics, support records and log redaction.** No application logging practice establishes a global provider no-logging guarantee.

## Sharing and providers

Activation, invitations, recovery and platform setup send recipient details and transactional links through the selected SMTP or Resend adapter. File content goes to configured object storage; MongoDB hosts account and metadata records. Google OAuth requests email/profile scopes and returns verified identity information; exact stored fields are determined by the authentication flow, not a promise that Google discloses no other data.

Enabled AI requests share prompt, bounded history, system instruction and minimized tool results with OpenRouter/downstream providers or Google Gemini. The normal tool flow does not send uploaded file bodies; pasted prompts can include customer information. Provider/model settings and privacy terms must be reviewed. [OpenRouter's policy](https://openrouter.ai/privacy) distinguishes its own processing from downstream model practices. [Gemini API terms](https://ai.google.dev/gemini-api/terms) distinguish paid/unpaid data handling; actual account status is unverified. Do not promise no training, no human review, or zero retention across the chain.

Optional Stripe uses hosted provider pages; the application does not implement its own card-entry form. The current integration is test-only. Provider notices and contract roles are separate from this draft. [SUBPROCESSORS](SUBPROCESSORS.md) is a conditional review list, not a confirmed production list.

**TODO: approve actual provider entities, services/regions, agreements, transfer safeguards, downstream AI disclosure, and lawful disclosure/request handling.** Do not assume every integration is enabled or every provider has the same legal role.

## Browser storage and OAuth cookies

Tenant and platform Bearer tokens use separate browser sessionStorage entries. The gateway forwards authorization but does not forward cookies or store sessions. Google sign-in uses an HttpOnly state-binding cookie; HTTPS uses secure host-only settings. Exchange/reset codes are removed from frontend history by the relevant screens. See [architecture](../architecture.md).

**TODO: audit deployed cookies/local storage, hosting instrumentation and third-party tracking; approve a cookie inventory and any necessary preference mechanism.** Do not label the service cookie-free or infer consent from session storage. This draft adds no consent control.

## Retention, deletion, access and rights

[DATA_RETENTION](DATA_RETENTION.md) separates implemented expiration/deletion from unresolved policy. File/conversation deletion does not erase historical usage, audit records, provider logs or backups. Company closure, complete personal-data export/erasure and request verification/response procedures require approved operations; no general self-service closure/export endpoint is claimed.

**TODO: establish eligible rights, lawful bases, request contact/identity checks, customer/operator coordination, response periods, exceptions/legal holds and appeal/escalation.** Do not promise a deletion deadline or unsupported export format. **TODO: approve age restrictions and treatment of children's/regulated data.**

## Security and incidents

Implemented controls include purpose-separated authentication, DB-derived tenant authorization, private file storage and bounded provider/tool requests. These reduce risk without guaranteeing perfect security or certification. **TODO: verify deployment access controls, encryption/key management, monitoring, backups, incident response owner and investigation workflow.**

Proposed incident procedure for approval: assess and contain, preserve appropriate evidence, identify affected data/customers/providers, coordinate remediation, and communicate through approved channels where required. **TODO: counsel/operator approve notification triggers, deadlines, recipients and contact channels.** No existing automated incident-notification workflow or compliance certification is established by this draft.
