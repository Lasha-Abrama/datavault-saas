# Data Retention and Deletion

> **DRAFT — NOT EFFECTIVE. Owner/legal review required. Do not publish as a final policy or collect agreement to this draft.**
> Operator: **TODO: legal entity**. Effective date/version: **TODO**. Contact: **TODO: approved public contact**.

## Scope

This is a technical inventory and policy decision sheet, not an adopted retention schedule. The source-code [MIT license](../../LICENSE) is independent of customer-data retention and hosted-service terms. Personal information may exist within account records, uploaded files, conversations and operational metadata; it does not become open-source data.

## Implemented behavior versus policy

| Data                                          | Confirmed application behavior                                                                                                                                                        | Policy decision / limitation                                                                 |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Company/user records                          | Stored in MongoDB; owners can remove employees, not themselves. Suspension blocks access without erasure. No general company closure endpoint identified                              | **TODO: closure, export, deletion/anonymization, legal holds and support procedure**         |
| File objects/metadata                         | Authorized deletion removes the S3 object before metadata; failure can require reconciliation. Employee removal does not cascade-delete historical file metadata/recipient references | **TODO: orphan cleanup, S3 versions/lifecycle/replication and backup deletion**              |
| Upload usage/billing                          | Deleting files does not decrement historical uploads/charges; billing and Stripe worker records persist without a general cleanup schedule                                            | **TODO: accounting/legal retention and minimization**                                        |
| AI conversation/message content               | Authorized conversation deletion removes its visible content; normal history limits are size/count bounds, not a time-based retention policy                                          | **TODO: time-based content retention and account-closure cleanup**                           |
| AI usage                                      | Content-free records with user/company references remain after conversation deletion; no time-based TTL found                                                                         | **TODO: retention and anonymization**                                                        |
| Activation verification                       | Tokens valid for 24 hours; verification document has an expiry TTL index                                                                                                              | Expiry is not immediate physical deletion; pending company/user records are separate         |
| Employee invitation                           | Tokens valid for 72 hours; invitation expiry TTL index exists                                                                                                                         | Expiration/cleanup does not erase users already created by acceptance                        |
| Google OAuth state/exchange                   | State/registration flow uses 5-minute validity; sign-in exchange uses 1 minute; expiry TTL indexes exist                                                                              | MongoDB TTL cleanup is asynchronous; token validity checks are separate                      |
| Tenant/platform password recovery             | Reset validity is 30 minutes; hashes/expiry fields live on identity records and are consumed/cleared by workflows                                                                     | Expired fields do not imply entire identity deletion or an automatic retention schedule      |
| Tenant/platform sessions                      | JWT lifetimes are one hour / 30 minutes; browser sessions use separate sessionStorage entries                                                                                         | Session expiry is an access limit, not database retention                                    |
| Admin access requests/audits                  | Access-request lifecycle and append-only audit protections exist; no general purge schedule identified                                                                                | **TODO: retention/minimization that preserves justified accountability**                     |
| Provider data, host logs, backups and support | Controlled partly by deployment/provider settings, not established by repository code                                                                                                 | **TODO: inventory actual retention, regions, backup rotations, holds and deletion requests** |

Evidence: [security](../security.md), [AI](../ai.md), [admin](../admin.md), [verification schema](../../src/auth/entities/company-verification.entity.ts), [invitation schema](../../src/invitations/entities/employee-invitation.entity.ts), [OAuth flow](../../src/auth/google-oauth-flow.service.ts), [reset implementation](../../src/auth/password-recovery.service.ts), [AI service](../../src/ai/ai.service.ts), and [billing](../billing.md).

## Operational deletion decisions

**TODO:** approve request verification, customer versus individual authority, scope across S3/MongoDB/provider systems, pending-job handling, backup recovery/re-erasure, deletion evidence, deadlines/exceptions and escalation. Destructive maintenance tools have narrow safeguards and explicit authorization requirements; they are not a general customer erasure service.

No backup period, deletion SLA, immutable-backup expiry, or guaranteed remote-provider erasure is established. S3 versioning/lifecycle and database backup settings must be inspected privately for the actual deployment. See [provider review](SUBPROCESSORS.md) and [privacy](PRIVACY_POLICY.md).
