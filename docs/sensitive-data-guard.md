# Sensitive Data Guard — architecture audit and implementation proposal

**Status: architecture proposal; later implementation phases require separate review.**
The gated, scan-only Phase 1 backend is now documented in [the implementation guide](sensitive-data-guard-phase1.md). The audit and future-phase proposals below describe their original review baseline; they are not a claim that every proposed capability is implemented.
Reviewed on 2026-10-11 against clean `main`, commit `847a8c1`. All new APIs,
models, limits, modules and behaviors below are proposals requiring review.
No dependencies, environment variables, secrets, source code or deployments are
changed. Existing [security](security.md), [billing](billing.md),
[development](development.md) and [legal retention draft](legal/DATA_RETENTION.md)
remain authoritative for implemented behavior.

## Recommendation and scope

Build an optional, local-only, asynchronous service for **existing, authorized
`.xlsx` files**. Leave normal upload/download behavior intact. Users scan a
stored workbook, review metadata-only findings, select transformations, and
create a separate private file. Never overwrite the source object or cell data.
The first release is post-upload inspection, not a pre-upload blocking policy.
Legacy `.xls`, CSV, XLSM, XLSB, encryption and arbitrary document formats are out
of scope even though normal uploads currently accept CSV/XLS/XLSX.

Use deterministic detector plugins and a bounded workbook adapter. Do not
connect this module to `AiModule`, OpenRouter, Gemini, browser parsing, or any
external content-analysis API. S3 remains the existing private storage provider;
“local-only” means detection runs in controlled backend compute, not that files
stop being stored by the configured storage/database providers.

Deliver full redaction first. Keep partial masking, keyed pseudonymization and
column removal behind separately reviewed capability gates. A result is
**“selected targets transformed and verified within the supported profile”**,
not “contains no personal information.” Detection has false positives/negatives;
checksum validity never proves that a real account/card/person exists.

## Existing architecture findings

| Area                 | Actual implementation and evidence                                                                                                                                                                                                                                         | Design consequence                                                                                                                                             |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Baseline             | `main` is clean at `847a8c1`; separate backend/frontend packages                                                                                                                                                                                                           | Planning changes only; preserve stabilization and licensing work                                                                                               |
| Upload               | [FilesController](../src/files/files.controller.ts) accepts one multipart `file`; [FilesModule](../src/files/files.module.ts) limits files/fields/parts and buffered size                                                                                                  | Reuse stored-file processing; do not change the sequential frontend batch queue or add synchronous scans to upload                                             |
| Validation           | [file-validation.ts](../src/files/file-validation.ts) verifies extension/MIME, CSV text, XLS signature and XLSX ZIP directory/required entries                                                                                                                             | XLSX upload validation does not parse cells, check decompression budgets, or provide malware/DLP protection                                                    |
| Lifecycle            | [FilesService.upload](../src/files/files.service.ts) puts a random tenant S3 key, commits metadata/quota together, compensates known failures, and preserves objects on uncertain commits                                                                                  | Derived publication must reuse these accounting/compensation invariants and add durable operation identity                                                     |
| Download/delete      | [FilesService.download](../src/files/files.service.ts), [delete](../src/files/files.service.ts) and [controller](../src/files/files.controller.ts) stream private objects; deletion removes S3 then metadata                                                               | Retain headers and owner/uploader deletion rights; handle retries and source deletion during work                                                              |
| Storage              | [ObjectStorage](../src/aws-s3/object-storage.ts) offers buffered put, streamed get, delete; [AWS adapter](../src/aws-s3/aws-s3.service.ts) uses private object commands                                                                                                    | No object-version, conditional-get, digest, background cleanup or processing API exists; stored S3 versioning settings are unverified                          |
| Metadata             | [CompanyFile](../src/files/entities/company-file.entity.ts) has immutable company/uploader/key/type/size plus mutable permissions and timestamps                                                                                                                           | No source hash, file version, parent/derived relationship or sanitization history exists                                                                       |
| Authorization        | [IsAuthGuard](../src/guards/is-auth.guard.ts) derives current user/company/role from DB, checks activation/suspension/auth version; [FilesService accessFilter](../src/files/files.service.ts) scopes by tenant/visibility/uploader                                        | Reuse the same checks on job creation, results, generation, listing and downloads; platform metadata access is not content authority                           |
| Roles                | Owners access all tenant files; members access company-wide, their uploads and explicitly granted files. Only owner/uploader can mutate original permissions/delete                                                                                                        | Proposed scan permission follows read access; generating a separate file is not authority to modify the original                                               |
| Quotas               | [EntitlementsService](../src/subscriptions/entitlements.service.ts) serializes stored counts and usage with the subscription lock; Premium can enqueue overage                                                                                                             | Recommend treating a saved derived copy as one ordinary stored file/upload, subject to approval; scans do not consume existing upload usage                    |
| Downgrades           | [DowngradeCleanupService](../src/subscriptions/downgrade-cleanup.service.ts) can remove files and users                                                                                                                                                                    | Derived files must participate in counts/cleanup; pending jobs must detect source/user removal without breaking existing cleanup                               |
| Parsing dependencies | Neither package declares ExcelJS/SheetJS/Presidio or a workbook engine. Root lockfile contains `libphonenumber-js` transitively through existing validation dependencies                                                                                                   | Evaluate direct, pinned dependencies before importing them; do not rely on incidental transitive imports                                                       |
| Background work      | [PaymentsWorker](../src/payments/payments.worker.ts) polls MongoDB with conditional claims; [AI lease](../src/ai/ai.service.ts) serializes conversations                                                                                                                   | Useful patterns, not a general queue or sandbox. Add an independent Guard worker; never reuse payment or AI execution paths                                    |
| Timeouts             | [API helper](../frontend/lib/api.js) and [gateway](../frontend/app/backend/[...path]/route.js) have 90-second request bounds; gateway explicitly allowlists routes                                                                                                         | Return jobs promptly and poll. New routes require narrowly scoped allowlist entries; browser disconnect is not job cancellation                                |
| Audits               | [AdminAudit](../src/admin/entities/admin-audit.entity.ts) has platform actors/action enums and append-only protections                                                                                                                                                     | There is no tenant scan/file audit service. Add separate tenant Guard events; do not put employee actors into platform audit records                           |
| Frontend             | [FileDetail](../frontend/components/files/files-workspace.js) loads metadata, downloads, edits permissions and deletes; no workbook preview or Guard actions                                                                                                               | Add a focused Guard action/workspace, preserving the existing modal, permissions, downloads and uploads                                                        |
| Tests                | [validation](../src/files/file-validation.spec.ts), [lifecycle unit tests](../src/files/files.service.spec.ts), [HTTP files](../test/files.e2e-spec.ts), [storage tests](../src/aws-s3/aws-s3.service.spec.ts), [browser regressions](../frontend/tests/workspace.spec.js) | Existing coverage includes tenancy, visibility, quotas, concurrency, partial uploads and compensation; minimal ZIP fixtures are not valid processing workbooks |

File bytes have no public replacement API, but immutability must not be assumed
against out-of-band storage changes. Processing binds a server-computed source
SHA-256 to the job and checks it again on generation. Keep digests internal and
tenant-scoped; never hash detected values into findings or use cross-tenant dedup.
S3 ETags alone are not a substitute for a content digest.

## Detection design

A detector returns category, versioned rule ID, validation code and location,
never the matched value. Extraction is bounded, deterministic and Unicode-aware
where supported. Use literal length limits and linear tokenization before small
regexes/checks; no user-supplied arbitrary regex engine in version 1. Maintain
synthetic positive/negative corpora per detector, including overlapping matches.

| Category                   | First-version strategy                                                                                                                                  | Finding classification / limitations                                                                                                                                             |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Email                      | Bounded candidate extraction plus the existing validator's supported email syntax                                                                       | `format_valid`; does not establish deliverability, ownership or secrecy. Obfuscated/unsupported international forms remain a documented limitation                               |
| Phone                      | `libphonenumber-js` with reviewed full validation metadata; international forms or an explicitly selected country/region                                | `format_valid` for validated candidates, `possible` when only plausibility is established. Company country does not prove a person's numbering region; do not silently assume it |
| National/personal ID       | Versioned, jurisdiction-specific plugin only after authoritative format/checksum rules, licensing and fixtures are reviewed                             | No generic numeric-ID detector. Initial enabled list can be empty until owner selects jurisdictions; syntax-only identifiers stay `possible`, never “identity confirmed”         |
| Payment card               | Bounded digit/separator candidates; approved common PAN lengths (proposed 13–19), reject trivial repeated digits, run Luhn; context may help prioritize | `checksum_valid`, not an issued/live card. Common-length scope misses other representations; numeric account/order values can be false positives                                 |
| IBAN                       | Normalize permitted spaces/case, approved registry country/length/character structure, then ISO 7064 MOD 97-10                                          | `checksum_valid`, not a live bank account. Pin a reviewed registry snapshot; no network lookup per cell                                                                          |
| IPv4/IPv6                  | Bounded candidates validated with Node `net.isIP`, not a universal address regex                                                                        | `format_valid`; addresses may be public/private and not necessarily identifying. URLs/ports/CIDR need explicit extraction rules                                                  |
| Selected sensitive columns | Explicit worksheet ordinal/column index, with user-approved header handling                                                                             | `user_selected`, not a statistical detection. Apply to all actual cells, including hidden rows; avoid relying on potentially sensitive header names                              |

Expose categorical evidence (`format_valid`, `checksum_valid`, `possible`,
`user_selected`) and explanatory rule codes, not an invented probability or
“confirmed PII” label. Dates, numeric precision loss, Excel-rendered versus
stored text, leading zeros, text split across cells and custom formatting can
cause missed matches. Do not reconstruct lost identifiers or guess missing data.
All cells, including first-row headers, are data. Deduplicate overlapping
findings per category/location while retaining rule evidence and counts.

National IDs require an owner-approved country list. An unavailable national-ID
plugin is reported as unsupported/not enabled, not silently treated as a passed
check. Generic confidential business content and names are not detected by this
first version; selected columns provide deliberate coverage beyond patterns.

### Detector and library research

[Presidio Analyzer](https://presidio.dataprivacystack.org/analyzer/) supports
recognizers combining patterns, checks and contextual signals, and
[Presidio structured](https://presidio.dataprivacystack.org/structured/) addresses
tabular data. Use its explainable recognizer approach as a design reference.
A Python service/NLP runtime and dataframe conversion are unnecessary for this
narrow Node-first version, and do not solve workbook fidelity. Reconsider local
Presidio later for separately evaluated detection needs; it is not perfect DLP.

[Phone library documentation](https://github.com/catamphetamine/libphonenumber-js)
distinguishes possible/valid numbers and metadata precision. Use a direct,
reviewed dependency when implementing. [SWIFT's registry](https://www.swift.com/standards/standards-resources)
is the authoritative source for supported IBAN formats; select the actual
registry version and permitted redistribution before implementation.
[Node's IP validation](https://nodejs.org/api/net.html#netisipinput) provides the
address validator. No dependency was installed and no detector was benchmarked
by this planning task.

## Workbook processing and sanitization

### Adapter selection and support gate

Evaluate **ExcelJS** as the Node/TypeScript adapter, behind an internal interface;
select a pinned release only after security/license review and a round-trip
fixture spike. Its documented capabilities include XLSX data/styles, merges and
formula representations, but it does not calculate formulas, and moving merged
cells through splice operations has documented limitations. Do not infer full
Excel fidelity from library API support. [ExcelJS documentation](https://raw.githubusercontent.com/exceljs/exceljs/master/README.md).

Preflight the raw OOXML package before the workbook library: bounded ZIP reading
(for example, reviewed `yauzl` with lazy entries, strict names and size checks)
plus a reviewed namespace-aware XML reader that rejects DTD/entities and never
resolves external resources. Runtime decompressed-byte counters are mandatory;
ZIP declarations alone are not trusted. The [ZIP reader documentation](https://github.com/thejoshwolfe/yauzl)
describes size verification, which is only one layer of the required limits.

A strict package/element/relationship allowlist prevents the library silently
dropping or retaining unsupported content. Do not merely copy original ZIP parts
to a “sanitized” output. Reconstruct only the supported model, then independently
inspect output parts and rescan before any storage publication.

### Proposed first-release workbook profile

| Feature                                                                                                                       | Inspection                                                                                                                  | Sanitized-copy behavior                                                                                                                                                                                                                         |
| ----------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Literal text/numbers/dates/booleans and ordinary styles                                                                       | Scan textual forms with type/precision limitations recorded                                                                 | Redact the entire selected cell to explicit string `[hidden]`; retain supported safe cell styles, dimensions and ordering                                                                                                                       |
| Hidden/very-hidden sheets, hidden rows/columns                                                                                | Always scan; state is not an exclusion                                                                                      | Preserve supported visibility states and apply transformations there too; user cannot omit them by an accidental default                                                                                                                        |
| Merged cells                                                                                                                  | Inspect raw cells and the logical master; reject conflicting payloads in non-master cells                                   | Whole merged value is one target. Preserve merge/style only when fixture tests pass; reject partial-column selection crossing a merge unless the user selects the whole merge                                                                   |
| Shared/inline/rich strings                                                                                                    | Inspect all referenced cell content, including text runs; detect unused shared-string payloads as package metadata findings | Rebuild referenced strings; remove unused originals. Selected rich text becomes a plain marker, retaining safe cell-level styles                                                                                                                |
| Formulas, shared/array/dynamic formulas and cached results                                                                    | Inventory and optionally detect on bounded stored formula/cache text without evaluation; coverage remains limited           | **Block generation in version 1**. Do not retain hidden literals/caches, recalculate, guess dependencies or silently convert to values                                                                                                          |
| Sheet titles, headers, footer text and core/custom properties                                                                 | Treat source text as potentially sensitive; results use safe ordinals/codes, not copied labels                              | Proposed output uses generic sheet names and clears author/company/custom document properties. Cell headers follow selection rules; unsupported header/footer constructs block generation. Disclose naming/metadata changes before confirmation |
| Hyperlinks, external relationships, defined names, data validation, tables, conditional formatting                            | Inventory safely; never follow links or evaluate expressions                                                                | Outside initial generation profile; block rather than silently retain/drop. Any future support requires explicit transformation and residual checks                                                                                             |
| Images/charts/shapes, pivots/caches, comments/threaded comments, embedded objects, macros, connections/custom XML, signatures | Report unsupported package coverage without rendering or executing                                                          | Block generation; do not claim these areas are sanitized. A plain `.xlsx` extension does not override package content                                                                                                                           |
| Encrypted/password-protected packages or structurally ambiguous XML/ZIP                                                       | Fail closed with generic reason codes                                                                                       | No decryption or output; no password collection                                                                                                                                                                                                 |

This conservative profile intentionally rejects many real business workbooks.
The library spike must identify exact permitted OOXML parts/elements and safe
style text fields, including custom number-format literals and font metadata.
Unknown extension nodes or unprocessed text-bearing parts are blockers, not
warnings that users can override to obtain a “sanitized” label. If literal scans
are possible on an unsupported workbook, results must say `generationEligible:
false` and enumerate coverage gaps; `completed` never implies full coverage.

Default UI labels are `Sheet 1`, `Column C`, `C17`. Do not persist original sheet
names, headers, filenames, string previews, comments or value fragments in scan
findings. Existing authorized file metadata remains in the ordinary file service;
Guard audit/log entries contain only opaque identifiers and safe codes.

### Transformation strategy evaluation

| Strategy                       | Recommendation                                                                                           | Risk / acceptance gate                                                                                                                                                                                                              |
| ------------------------------ | -------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Full redaction                 | Version 1: replace selected whole cells with `[hidden]`, including whole-column selection when requested | Changes types and analytical usefulness. Whole-cell behavior avoids keeping unmatched fragments; output strings must never become formulas                                                                                          |
| Partial masking                | Later opt-in, category-specific rules; fallback to full redaction                                        | Remaining characters can identify people/accounts. Do not use it as a default preview or promise anonymization                                                                                                                      |
| Deterministic pseudonymization | Defer; justify with a specific analytical use case                                                       | Would need approved key management and category/domain-separated keyed tokens, scoped at most per tenant/copy. No raw-value mapping/unkeyed hash; still personal data, potentially linkable and vulnerable to known-input inference |
| Column removal                 | Later capability on explicitly supported simple workbooks                                                | Rebuild/remap rather than naive splice; reject affected merges/references until proven safe. Requires clear row/header/column-shift preview and structure tests                                                                     |

Version 1 UI offers full redaction of category matches or all cells in selected
columns; it must not offer unimplemented transformations. Whole-column header
inclusion is explicit: version 1 treats row 1 as the optional header row, without
guessing multi-row headers. Choosing to exclude that row does not exempt it from
category-based redaction. Numeric values representing identifiers are not preserved
as numbers after redaction. No formula evaluation, external fetch, desktop Excel
invocation, or conversion to CSV occurs. When writing XLSX, use explicit literal
string types even for text beginning `=`, `+`, `-`, or `@`. CSV formula-injection
rules are a relevant warning, not a replacement for XLSX formula/type checks.
[OWASP guidance](https://community.owasp.org/attacks/CSV_Injection).

### Output verification

Verify source bytes have the same digest; never PUT to the source key. Before
publication, reopen output in the isolated process and independently verify:
valid bounded ZIP/XML, expected worksheet/cell/merge/style structure, explicit
literal marker types, no prohibited parts/formulas/links, no dangling/unused
original shared strings, and every selected target transformed. Re-run selected
detectors on targets and report residual findings in unselected data separately.
Assert selected synthetic canaries are absent across all output text-bearing
parts, not just the workbook adapter's cell objects. Canonical typed output
comparison validates unaffected values within the approved profile. Do not
persist raw source/output comparisons or emit them in failing assertions/logs.
Result manifests report changed counts, coverage, dropped metadata and remaining
finding counts. They do not certify all sensitive information was discovered.

## Proposed authorization and data model

### Authorization contract

- Every HTTP operation uses `IsAuthGuard`; never accept company ID, uploader ID,
  raw storage key, model name or a client-defined authorization context.
- Any tenant user with current source read access may request a scan. Results
  are restricted to the requesting user and current source access; owner access
  to another user's scan is **not** implicitly granted. Tenant owners can start
  their own scan. Platform-admin tokens cannot scan/download workbook content.
- The scan requester may generate a separate copy while still authorized to
  read the source and create a file under current entitlements. This does not
  modify source data/permissions or grant new original-file mutation rights.
- At enqueue, worker claim, publication, results/listing and download, reload
  actor membership/company status and applicable source access. Store actor IDs,
  never Bearer tokens. Filter all job/finding/event queries by company and actor
  where appropriate; deny cross-tenant IDs with non-enumerating 404.
- Derived copies initially inherit current source visibility/recipients at
  publication, with the generator as uploader. Recommended first-release Guard
  access requires **both** derived and source authorization, so later source
  restriction cannot be bypassed through Guard lineage. Original-file behavior
  remains unchanged. Sharing/broadening a derived copy is blocked in version 1;
  enabling independent sharing later needs a policy decision.
- Apply the same additional lineage check in normal derived-file list/detail/
  download paths, not only Guard endpoints. Never reveal an unauthorized parent
  through a source link. Source deletion makes lineage-dependent copies
  unavailable pending explicit cleanup/retention handling; do not silently
  cascade-delete originals or other copies. Owners/uploaders retain authorized
  derived deletion ability without needing a now-deleted parent's read access.
- Revalidation follows the existing request authorization boundary: already
  authorized work can race a permission change. Do not promise instantaneous
  revocation of in-flight output. If strict commit-time fencing is required,
  approve a shared file-authorization revision/transaction-lock design covering
  permission updates/deletion/downgrade cleanup before implementing publication.
  Do not claim a final read alone is atomic with competing mutations.

This Guard contract cannot stop someone who already downloaded a workbook from
copying it outside the application. It controls the managed feature's operations.

### Collections and indexes — schema approval required

| Proposed model                   | Fields (no raw detected values)                                                                                                                                                                                                                                                                                                                                                                                                                              | Indexes/lifecycle                                                                                                                                                                                                 |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GuardJob`                       | immutable `companyId`, `requestedBy`, `sourceFileId`; `kind` (`scan` or `sanitize`); optional `scanId`; request UUID, server-computed request fingerprint; source digest/internal storage identity; detector/engine/profile versions; bounded category/region/index selectors; transformation manifest; status/phase/counters; coverage and safe error code; lease token/expiry/attempt; cancel flag; optional resulting file ID; timestamps/approved expiry | Unique `(companyId, requestedBy, kind, requestKey)`; queue `(status, nextAttemptAt, leaseExpiresAt)`; source history `(companyId, sourceFileId, createdAt)`; requester history index. No public digest/key fields |
| `GuardFinding`                   | company, scan/job, ordinal/finding ID, sheet ordinal, row/column/address or a controlled package-location code, category, rule ID, validation code, optional hidden/merge flags                                                                                                                                                                                                                                                                              | `(companyId, scanId, ordinal)` unique and indexed for bounded cursor pagination; summary indexes only if justified. No sheet/header text, example, raw value, value hash or matched substring                     |
| `GuardEvent`                     | company, actor/system identity, source/job/derived IDs, action enum, safe reason, selected category/action enums and aggregate counts, engine version, timestamp                                                                                                                                                                                                                                                                                             | Tenant/target/time indexes; append-only application policy. No cell coordinates, filenames, request body, value fragments or free-form error text in audit events                                                 |
| Existing `CompanyFile` extension | optional immutable derivation object: `sourceFileId`, `guardJobId`, `scanId`, `engineVersion`, `verificationScope: selected_targets`                                                                                                                                                                                                                                                                                                                         | Partial unique `(companyId, derivation.guardJobId)` for derived records; `(companyId, derivation.sourceFileId, createdAt)` for history. Existing records need no backfill; original fields unchanged              |

Scans and copies have distinct jobs. A successful scan is immutable; re-scan
creates another version. Generation is bound to scan/source digest/engine
versions and rejects stale/expired/incomplete scans. Version 1 limits generation
to original files; derived copies remain downloadable/scannable, with chained
copy generation deferred until bounded lineage and deletion semantics are agreed.

No saved policy/Excel policy-template schema is needed for this scoped release.
Selectors are validated ordinals/indexes, not executable spreadsheet instructions.
Do not add arbitrary custom keywords, regex policy imports or AI detectors as
part of these phases.

### API proposal

All endpoints return private/no-store responses and sanitized stable errors.
Inputs use strict DTO validation, bounded arrays, enums and UUID/ObjectId checks.
Request UUID is in JSON so the gateway need not forward a new idempotency header.

| Endpoint                                                     | Proposed behavior                                                                                                                                                                                |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `POST /files/:id/guard/scans`                                | `202` enqueue scan; identical request UUID/body returns existing job; reused UUID with another body returns `409`                                                                                |
| `GET /files/:id/guard/jobs?limit=20&after=...`               | Requester's jobs/history within current source scope; cursor pagination, capped at 50. Optional validated `requestKey` UUID filter recovers a lost `202`                                         |
| `GET /guard/jobs/:jobId`                                     | Job state, safe real progress/coverage/capabilities, no values or internal keys                                                                                                                  |
| `GET /guard/scans/:scanId/findings?limit=50&after=...`       | Completed/authorized scan's bounded findings (cap 100), safe ordinals and counts; optional enum/index filters                                                                                    |
| `POST /guard/jobs/:jobId/cancel`                             | Idempotent cancellation request; queued jobs cancel immediately, running jobs reach a safe checkpoint or are terminated; terminal completed jobs do not become undone                            |
| `POST /guard/scans/:scanId/copies`                           | `202` generation job, immutable selection manifest, same durable UUID rules                                                                                                                      |
| `GET /files/:id/guard/copies?limit=20&after=...`             | Authorized managed-copy metadata and verification summary, no parent data leakage                                                                                                                |
| `GET /files/:derivedId/download`, `DELETE /files/:derivedId` | Existing download/delete interface plus required derived authorization/lifecycle handling; no new public URL                                                                                     |
| `DELETE /guard/scans/:scanId`                                | Requester discards findings; cancel active scan and securely clean temporary results. Does not delete source or published copies/audits; defined retention tombstone preserves mutation recovery |

Example scan request (all values synthetic, no cell content):

```json
{
  "requestKey": "11111111-1111-4111-8111-111111111111",
  "categories": ["email", "phone", "payment_card", "iban", "ip"],
  "phoneRegion": "GE"
}
```

Example job response; phases reflect actual worker state, not an estimate:

```json
{
  "jobId": "aaaaaaaaaaaaaaaaaaaaaaaa",
  "kind": "scan",
  "status": "running",
  "phase": "scanning",
  "progress": { "processedCells": 1200, "totalCells": null },
  "coverage": { "status": "pending", "hiddenAreasIncluded": true },
  "generationEligible": false
}
```

On completion include category counts, safe worksheet/column inventory, enabled/
unsupported categories, `coverage.status: supported|limited`, reason codes and
`generationEligible`. A finding can be:

```json
{
  "findingId": "bbbbbbbbbbbbbbbbbbbbbbbb",
  "sheetIndex": 0,
  "row": 17,
  "column": 3,
  "address": "C17",
  "category": "payment_card",
  "ruleId": "pan_luhn_v1",
  "validation": "checksum_valid",
  "hidden": false
}
```

Example copy request, selecting matches and a whole sensitive column:

```json
{
  "requestKey": "22222222-2222-4222-8222-222222222222",
  "actions": [
    {
      "scope": "category_matches",
      "categories": ["email", "payment_card"],
      "action": "redact"
    },
    {
      "scope": "column",
      "sheetIndex": 0,
      "column": 3,
      "includeHeader": true,
      "action": "redact"
    }
  ]
}
```

The server derives target cells from the immutable scan and validated column
inventory, unions overlaps once, rejects invalid selectors/conflicting actions,
and binds choices to a canonical manifest digest. It never trusts client value
snippets, unbounded coordinates or unchecked ranges. A selected column is a
whole-column operation, not merely its currently detected cells. This covers
user-selected information that no detector recognizes.

Completed generation returns `resultFileId`, changed counts, remaining finding
counts, coverage and transformation scope. Generated names are generic
`sanitized-<opaque-id>.xlsx`; no source headers/person names enter a new filename.
Useful errors: `guard_unsupported_format`, `guard_profile_unsupported`,
`guard_limit_exceeded`, `guard_source_changed`, `guard_source_unavailable`,
`guard_scan_expired`, `guard_selection_invalid`, `guard_output_verification_failed`.
No parser/provider message is forwarded. `401/404` cover lost access, `403` quota/
role denial, `409` stale/conflicting state, `413` byte budget and `429` workload
limits. Application code must map exceptions consistently with current APIs.

## Execution, privacy and threat model

### Durable asynchronous execution

Use a dedicated Mongo-backed Guard job collection and conditional leased claims;
no Redis/Bull infrastructure is required initially. A controller only authorizes,
validates and records a job/event transaction. The long-lived worker streams a
bounded source download, verifies its digest, and hands bytes to an isolated
parser process. Proposed states:

`queued → running → completed | failed | cancelled | expired`

Real running phases: `fetching`, `preflight`, `scanning`, `transforming`,
`verifying`, `publishing`. Totals stay unknown until measured; do not invent a
percentage while enumerating a workbook. Use per-tenant fairness, bounded queues
and max active work per tenant/process. Periodic heartbeat and a fencing token
prevent an expired lease holder from publishing after a replacement worker.

Parser isolation must include OS/container memory/CPU limits, disabled network,
no inherited AWS/Mongo/AI credentials, no subprocess/external XML fetch capability,
read-only runtime and job-private temporary storage. Node heap limits alone do
not bound Buffer/native allocations. A child process alone is not a complete
sandbox. Deployment support for these controls is a release gate; propose the
smallest supported separate worker process/container after infrastructure review.
Do not enable parsing inside the API event loop as a shortcut.

Bound temporary files/streams, set restrictive permissions, use opaque paths,
terminate parser on deadline/cancel, close streams, then clean in `finally` and
on worker recovery. Do not persist raw workbook bytes in MongoDB, IPC tracing,
stdout/stderr or debug dumps. Memory cannot be promised instantly zeroized by JS;
keep lifetimes short and prevent crash dumps/telemetry capture.

### Proposed initial budgets — not measured or adopted

| Resource                | Conservative starting proposal for fixture/load testing                                                                                                          |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Compressed input/output | Minimum of existing file-size ceiling and 10 MiB                                                                                                                 |
| ZIP expansion           | 100 MiB aggregate, 20 MiB per entry, 1,000 entries, expansion ratio at most 100:1; runtime measured limits override declared sizes                               |
| Workbook                | 20 sheets; 250,000 actual populated cells aggregate; at most 100,000 rows and 512 columns per sheet; do not allocate from declared `dimension` or sparse indexes |
| Text/parser             | 64 KiB text per cell and bounded XML depth/attributes/tokens, string tables, styles, merges and relationships; exact secondary limits set by the spike           |
| Findings/selection      | At most 10,000 findings per scan and 100 column selectors; exceed limits with a non-complete result that cannot generate a copy                                  |
| Time/memory             | 30-second parser phase deadline, bounded IO deadline and 256 MiB OS memory target per parser; validate actual Node/runtime overhead before accepting this target |
| Concurrency/queue       | Initially one active job per tenant and one parser per worker; proposed queue cap 10 per tenant with short admission rate limits                                 |

These are proposals to approve and benchmark, not production capacity promises.
Reject unsafe ZIP64/multi-disk/encrypted archives in the initial profile, duplicate
or normalized-colliding paths, traversal, symlinks, conflicting local/central
headers, corrupt CRCs, wrong content types and invalid XML relationships.
Disable XML entities/DTD, external URI resolution and regex backtracking hazards.
No workbook triggers outbound HTTP/DNS, shell execution, macros or formula
calculation. Compressed input passing today's upload validator still requires
all Guard checks.

### Publication and compensation

1. Resolve the current actor/source again; verify scan completeness/version/hash.
2. Generate and validate output only in the parser sandbox. No source object PUT,
   permission mutation or delete is permitted by the Guard worker.
3. Allocate a new server-owned private S3 key and durable generation operation ID.
   Perform IO outside retryable MongoDB transactions.
4. Publish derived metadata, current quota/upload usage, completed job/result ID,
   and success event in one majority transaction with lease fencing and a unique
   generation-job relation. Reuse entitlement/subscription locking and existing
   failure/uncertain-commit behavior. Do not simply call upload then separately
   persist a job, which would leave duplicate copies on acknowledgement loss.
5. On known failure, compensate the new object; on unknown commit, primary/
   majority lookup by generation operation identity before any destructive cleanup.
   Retain uncertain objects with a durable reconciliation record. Retried API
   requests reuse the job; only known safe, uncommitted stages can retry.

Crash recovery/reconciliation needs deterministic object-operation mapping and
lease checks. Unique records alone do not atomically couple S3 and MongoDB.
A cancelled job cannot publish later; if publication already committed, return
its result and explain that cancellation cannot undo it. No successful copy is
silently deleted or original quota usage decremented.

### Retention and deletion proposal

Choose approved periods before enabling the feature. Proposed short-lived scan
findings/job selection retention (for example, 24 hours) is a decision, not an
existing policy; audit/idempotency recovery may need longer separate windows.
Published copies should initially behave as ordinary stored files, with no
unannounced automatic expiry, until company retention rules are approved.
Temporary bytes are removed as soon as each attempt ends, including failures.

Do not put a Mongo TTL index on derived metadata and expect it to delete S3.
Use a leased lifecycle worker for findings/temporary object cleanup and any
approved copy retention, then expire safe tombstones only after reconciliation.
Define source deletion, employee deletion, suspended-company jobs, downgrades,
audit retention, backups/object versions and legal holds before release. Source
removal cancels pending work; published copy handling must follow the approved
lineage/retention contract, not an implicit destructive cascade.

### Threats and required tests

| Threat                                | Required controls / evidence                                                                                                                                                             |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Cross-tenant or platform-admin access | Tenant-scoped job/findings/source/derived queries and purpose-separated auth; test guessed IDs, listing, job recovery, download/delete and UI route bypass                               |
| Revoked membership/source visibility  | Reload actor/access at transitions and reads, lineage gates; test permission/suspension/user removal during processing, with documented in-flight boundary                               |
| ZIP/XML/regex resource exhaustion     | Independent runtime budgets, sandbox, kill deadline; zip bombs, forged sizes, high cell indices, entity expansion, deep XML and long adversarial tokens                                  |
| Hidden residual data                  | Raw package inventory, mandatory hidden areas, strict unsupported profile, shared-string rebuild, metadata clearing and independent output inspection; canaries in all relevant carriers |
| Formula/network execution             | Reject generation for formulas/external relationships; typed literal writes and egress denial; formula/cache, DDE/HYPERLINK, URL and numeric-like string tests                           |
| Sensitive result/log leakage          | No raw strings or source labels in findings/errors/audit/telemetry; capture all logs/error serialization/IPC outputs with synthetic canaries; previews disabled by default               |
| Duplicate generation/lease race       | Durable UUID/body fingerprint, unique job relation, fencing and atomic usage/publication; test parallel requests, lost response, worker kill, expired lease and uncertain DB commits     |
| Object orphaning/partial deletion     | Existing compensation rules plus generation reconciliation and lifecycle jobs; inject S3/DB failures at every boundary and verify original bytes remain untouched                        |
| Misleading assurance                  | Coverage/certainty/scope fields and blocked generation for gaps/limits; test UI never says “no sensitive data” on unsupported, incomplete or failed work                                 |

## Frontend workflow

1. In existing `FileDetail`, show **Scan for sensitive data** only for eligible
   XLSX files. Backend capabilities/access remain authoritative. Keep ordinary
   download/delete/permissions controls unchanged; `.xls` gets a clear eligibility
   explanation rather than an automatic conversion.
2. Start with detector selection and optional phone region. Submit once using a
   retained request UUID, show immediate queued feedback, poll real phases with
   bounded backoff, and expose server cancellation. Closing/minimizing stops
   polling but does not falsely claim to cancel a durable job.
3. Review grouped counts by safe worksheet ordinal, column letter and category;
   paginate findings, show validation evidence/hidden flags and coverage blockers.
   A zero-match result means no enabled-rule matches in covered areas, not safe
   content. Keyboard-accessible column inventory allows explicit sensitive-column
   selection without persisting raw header labels.
4. Select category matches or whole columns for full redaction. Show affected
   counts, header inclusion, merged-range consequences, generic sheet naming and
   metadata clearing. Review unsupported cases before enabling Generate.
5. Confirm **Create sanitized copy**, with an explicit disclosure of selected
   scope and proposed quota/overage consequences. Submit one durable request and
   show transforming/verifying/publishing states. Reconnect to the existing job
   after network failure; no blind duplicate retry.
6. On completion, show new file, transformed counts, residual/coverage notice,
   **Download copy**, and per-source copy history. History never reveals a source
   or copy the actor cannot currently access. Deletion uses existing confirmation
   and authorization, with source/copy clearly distinguished.

No raw-value preview in version 1. If examples are later needed, prefer synthetic
examples; a real masked preview requires an explicit disclosure-risk review,
authorized transient rendering, minimal retention and a mask that cannot leak
short values. Last-four digits and email domains are not automatically safe.

Use existing Modal/Button/ErrorState/Loading primitives, focus management,
semantic fieldsets/checklists, labelled status/live regions, reduced-motion
indicators and an explicit cancel control. Avoid relying on color. On mobile,
use stacked group cards and paginated location lists rather than a full-width
spreadsheet grid; retain usable touch targets, focus restoration and draft
selection across reconnects. No raw strings in URL params, sessionStorage,
analytics events, screenshots or client error reports.

## Phased implementation roadmap

All phases require approved architecture/schema/library choices before coding.
Security and negative tests begin in Phase 1; Phase 5 is additional assurance,
not permission to expose unsafe intermediate phases. Review each phase separately;
keep the feature unavailable to users until all required gates pass. Proposed
new paths below do not exist yet. Complexity is relative, not a date estimate.

### Phase 1 — Backend scanning foundation

**Complexity: high. Dependencies:** owner-approved limits/profile/permissions and
worker deployment feasibility; library/security/license spike.

- Proposed new module files: `src/sensitive-data-guard/sensitive-data-guard.module.ts`,
  `guard.controller.ts`, `guard.service.ts`, `guard.worker.ts`, `guard.runner.ts`,
  `guard.constants.ts`, `guard-access.service.ts`, `dto/guard-scan.dto.ts`,
  `dto/guard-query.dto.ts`, `entities/guard-job.entity.ts`,
  `entities/guard-finding.entity.ts`, `entities/guard-event.entity.ts`,
  `workbook/xlsx-preflight.ts`, `workbook/workbook-adapter.ts`,
  `workbook/exceljs-adapter.ts`, `detectors/detector.ts`, and focused category
  detector files under `detectors/`.
- Existing touch points: `src/app.module.ts`, `src/files/files.service.ts` and
  `src/files/files.module.ts` (authorized internal processing-source interface),
  `src/docs/swagger.ts`, `src/docs/swagger.spec.ts`, backend manifest/lockfile and
  third-party dependency review. No upload validation rewrite or AI/payment edits.
- APIs: scan creation, job list/status/cancel and finding pagination from the
  contract above. `GuardJob`, `GuardFinding`, `GuardEvent` schemas/indexes only;
  no derived CompanyFile fields yet. Events/job enqueue commit together; pending
  jobs have explicit recovery/fencing. Add scanner admission limits.
- Tests: detector boundary/false-positive/false-negative corpora and property
  tests; canonical ZIP/XML fixtures, hidden cells, merges, shared strings,
  malformed files, limited/incomplete coverage; no egress/value logging; tenant/
  requester/purpose authorization; worker cancellation, lease restart and limits.
  New adjacent `*.spec.ts` and `test/guard.e2e-spec.ts` with controlled storage;
  real XLSX fixtures under `test/fixtures/guard/`, not the minimal upload ZIPs.
- Risk: parser resource exhaustion, unsupported carrier loss, confusing match
  certainty, finding-result leakage and insufficient sandbox support.
- Acceptance: bounded asynchronous scanning works without altering a source;
  results contain locations/evidence only; unsupported checks/features are
  explicit; unauthorized identifiers fail closed; realistic round-trip spike
  establishes the exact generation profile. No public generation capability yet.

### Phase 2 — Sanitization and derived-file creation

**Complexity: high. Dependencies:** Phase 1 and approved quota, lineage,
publication/revocation, retention and full-redaction semantics.

- New files: `guard-copy.service.ts`, `guard-lifecycle.service.ts`,
  `dto/guard-copy.dto.ts`, `workbook/workbook-sanitizer.ts`,
  `workbook/output-verifier.ts` plus adjacent tests under the new module.
- Existing files: `src/files/entities/company-file.entity.ts`/its tests,
  `src/files/files.service.ts`/its tests, `src/files/files.module.ts`,
  `src/aws-s3/object-storage.ts`/`aws-s3.service.ts` only if bounded/cancellable
  IO metadata support is needed, `test/files.e2e-spec.ts`, and Swagger files.
  Review `src/subscriptions/downgrade-cleanup.service.ts` for pending-job/lineage
  cleanup integration; preserve entitlements and payment behavior. Avoid a broad
  domain refactor; extract only publication/accounting helpers required to share
  the existing lifecycle correctly.
- APIs: copy enqueue, copy history and scan discard; existing derived file
  download/delete now recognize lineage. Add immutable derivation fields and
  unique generation-job indexes; extend job kind/manifest/result fields. Copy
  persistence, usage, success event and job completion are one transaction.
- Tests: selected category/whole-column unions, header behavior, hidden/merged
  cells, metadata/string-table cleanup, structure/style golden fixtures, denied
  advanced features; original byte digest unchanged; output canaries/rescan;
  quota/Premium accounting, parallel final slots, idempotency/body conflicts,
  fencing, source changes/revocation/deletion, every S3/DB failure boundary.
- Risk: silent data/format loss, residual values, authorization races, duplicates
  after uncertain commits, leaked copies, orphan objects and unintended billing.
- Acceptance: one new authorized copy per operation, originals untouched, no
  output published before independent verification, current quotas enforced,
  incomplete/unsupported inputs cannot produce a falsely successful result,
  compensation/reconciliation and lifecycle recovery demonstrated. Column
  removal/masking/pseudonymization remain disabled unless separately approved.

### Phase 3 — Frontend scan/review interface

**Complexity: medium. Dependencies:** tested Phase 1 API and scope/certainty text.

- Touch `frontend/components/files/files-workspace.js` (`FileDetail` action), add
  `frontend/components/files/guard-scan-workspace.js` and
  `frontend/lib/guard-jobs.js`; reuse `frontend/lib/api.js` and UI components.
  Update `frontend/app/backend/[...path]/route.js` with exact Guard route/method
  allowlist patterns, not a wildcard proxy. Add scoped rules in
  `frontend/app/globals.css` only where existing styles do not suffice.
- Consume scan POST/job GET/cancel/finding GET APIs. No extra DB or frontend
  spreadsheet dependency. Review the installed Next.js guides before code edits.
- Tests: new `frontend/tests/guard.spec.js`, focused helper tests where needed,
  `frontend/tests/gateway.spec.js`, existing file/workspace regressions. Cover
  duplicate submit, unsupported XLS, polling reconnect/cancel, source denied,
  findings pagination/groups, zero matches versus incomplete results, keyboard/
  reduced motion/mobile layouts and no sensitive storage/telemetry.
- Risk: UI trust replacing backend auth, fake progress, accidental leakage of
  source labels, replay on network failure or inaccessible group controls.
- Acceptance: accessible immediate/real status, durable reconnect, safe finding
  review and clear limitations; existing file actions and upload behavior pass.

### Phase 4 — Frontend sanitization workflow

**Complexity: medium. Dependencies:** Phase 2, agreed scope/disclosure and quota UX.

- Add `frontend/components/files/guard-copy-workspace.js`; extend scan workspace,
  `FileDetail`, Guard job hook and scoped CSS. Extend `frontend/tests/guard.spec.js`
  and existing download/permissions/cleanup browser tests as relevant.
- Consume copy POST/status/history and existing file download/delete; no new DB
  changes. Present only implemented `redact` actions and backend capabilities.
- Tests: category/column/header choices, conflicting/invalid selections, merged
  targets, profile blockers, explicit confirmation/overage warning, client double
  submit, lost `202` recovery, cancellation during publish, residual disclosures,
  copy history/download/delete without confusing the original, and revoked access.
- Risk: overstated anonymization, non-idempotent retries, unintended sharing or
  deletion, column selection mismatch and misleading preview.
- Acceptance: full review-to-copy flow works on desktop/mobile without raw
  previews, automatic mutations or source changes; output scope and limitations
  are visible; generated copy is distinguishable and managed through authorized
  existing file actions.

### Phase 5 — Security hardening and release verification

**Complexity: high. Dependencies:** Phases 1–4; separately authorized realistic
worker/storage/MongoDB test infrastructure and owner-approved retention policy.

- Extend `test/guard.e2e-spec.ts`, `test/files.e2e-spec.ts`, Guard unit/security
  suites, worker/lifecycle tests, `test/fixtures/guard/`, frontend Guard/gateway
  suites, and feature documentation. Add deployment-specific sandbox assertions
  and controlled integration/load/fault tests in separate reviewable changes.
- Exercise API/schema contracts under real replica-set transactions; current
  mocked HTTP tests do not prove commit/fencing/index behavior. Use disposable
  private storage and synthetic files with explicit authorization for provider
  integration tests. Test process kills, restart, lease expiry, reconnect, all
  IO/transaction uncertainty points, duplicate publication and cleanup recovery.
- Measure limits/latency/memory on actual worker runtime; corpus covers ZIP/XML
  attacks, formula/cache/hidden/metadata carriers, overlapping identifiers,
  Unicode/locale/precision edge cases, false negatives and fidelity. Validate
  output in supported Excel clients with approved synthetic fixtures; do not
  launch desktop Excel on untrusted production files.
- API gates: root format/lint/build, relevant then full Jest/HTTP suites, Swagger
  regression and dependency audit. Frontend gates: Node helper tests, isolated
  Playwright (exclude `live.spec.js`), production webpack build and formatting.
  There is no current frontend lint script; do not claim a frontend lint pass.
- Review endpoint admission limits, tenant isolation/lineage, audited mutations,
  cancellation and retention/deletion tests; scan all test logs/telemetry/exception
  paths for canary values. Security review and artifact dependency/license review
  are mandatory. Keep existing auth/admin/AI/billing/uploads regressions passing.
- Acceptance: every prior phase's gates, measured approved resource ceilings,
  sandbox/egress evidence, no sensitive-value leaks, verified managed-copy
  lifecycle and honest limitations. No production-ready claim from mocks alone.
  No new API/model shape is expected here unless tests expose a design flaw;
  review any correction separately. Production rollout is outside this task.

## Owner decisions before implementation

1. Approve this architecture, the three new collections and optional file
   derivation fields/indexes. Confirm post-upload XLSX-only scope and the strict
   supported workbook profile, including blocked formulas/advanced features.
2. Approve who may scan/create copies, creator-only finding visibility,
   lineage-dependent copy access/deletion and the in-flight revocation boundary.
   Decide whether strict transactional authorization fencing is required.
3. Select national-ID jurisdictions and official rule references; approve phone
   region defaults (explicit selection recommended), detector limitations and
   benchmark acceptance criteria. No universal identity validation promise.
4. Approve full-cell redaction/header behavior, generic sheet naming and metadata
   clearing. Decide later whether masking, pseudonymization or column removal
   justify their privacy/fidelity costs and additional scope.
5. Decide derived-copy quota/overage accounting and scans' workload entitlement.
   Recommended default: saved copies use existing upload accounting; scans have
   independent workload limits and do not alter AI or Stripe accounting.
6. Approve parser isolation/deployment support and measured limits, job rate/
   concurrency caps, worker lifecycle and dependency/license choices. A reliable
   always-running worker is needed; idle/serverless execution is not sufficient.
7. Approve scan/job/audit/idempotency retention, source/copy/employee deletion,
   orphan cleanup, backups/S3 versions and legal holds. The legal drafts contain
   no adopted retention/deletion guarantee; do not invent one.
8. Approve truthful product/privacy language and release/security acceptance.
   No external AI processing, saved company policies, spreadsheet policy imports
   or automatic pre-upload blocking is included in this proposal.

## Validation of this planning deliverable

Repository code, manifests, file/HTTP/browser tests and existing docs were
inspected; primary library/detection guidance was reviewed. Prettier passed for
the three changed Markdown files; local documentation validation passed for 30
Markdown files, 216 links/anchors, 18 npm script names and 68 template variables.
`git diff --check` passed. No application files changed. No dependency was installed, no
workbook parsed/redacted, no application test or production integration run, and
no schema/secret/environment/deployment changed. Library fidelity, limits and
runtime isolation remain unverified until the implementation spikes/tests above.
