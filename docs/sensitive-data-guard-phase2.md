# Sensitive Data Guard — gated sanitization foundation

Backend Phase 2, based on `645e37e`. Read [Phase 1](sensitive-data-guard-phase1.md)
and [the architecture proposal](sensitive-data-guard.md). No frontend, external AI,
partial masking, pseudonymization, tokenization, provider, environment, secret or
billing-policy change is included. Nothing was committed, pushed or deployed.

## Default-off safety and activation blockers

The frozen `DEFAULT_RUNTIME_POLICY` keeps **both** `isolationApproved: false` and
`sanitizationApproved: false`. There is no environment activation switch.
Sanitization admission requires both approvals; an authenticated, authorized scan
request otherwise receives `503 guard_runtime_not_approved`. Invalid/unauthorized
requests still receive normal validation/authorization errors. No job, reservation,
storage write or content processing results from denied admission.

The shared worker cannot claim/recover sanitization jobs without sanitization
approval. With isolation disabled it does not start polling, initialize Guard
collections/indexes, reconcile objects, read workbook content or spawn children.
Guard schemas retain `autoCreate: false` and `autoIndex: false`. Existing models
retain ordinary initialization. Status/history/cancellation remain scoped metadata
operations; the safety gates do not globally hide history or erase stored copies.
Existing private downloads/deletion of already published copies remain authorized.

Activation is **not approved**. Phase 1's verified OS/container memory/CPU/network
isolation, content-free telemetry/core-dump controls and non-root/read-only runtime
requirements remain blockers. Node permission flags/heap limits alone do not meet
those requirements. Retention, tombstone reconciliation, source/user/company removal,
backup/object versions/legal holds and workload capacity need owner/operations review.
The test harness approves providers only against synthetic localhost fixtures.

## Supported workbook subset

The source must be an authorized original `.xlsx`, with a completed requester-owned
`ooxml_scan_v1` scan. Generation from derived copies is rejected. The current source
bytes must match the scan's internal SHA-256 digest. Scan location/category metadata
is rederived in the child and compared with the saved findings digest.

Generation uses a small **canonical OOXML reconstruction**, not ExcelJS/SheetJS or
ZIP-part copying. The actual support profile is intentionally narrower than the
architecture's future spreadsheet-adapter proposal:

| Input carrier or feature                                                                                                                                   | Phase 2 behavior                                                                                       |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Unstyled literal text, finite numeric literals and booleans                                                                                                | Preserve typed values/coordinates/order except selected cells; explicit string redaction               |
| Empty represented cells, rows and multiple sheets                                                                                                          | Preserve represented cell/row structure and sheet order; no allocation from declared dimensions        |
| Hidden/very-hidden sheets, hidden rows/columns                                                                                                             | Always include targets; preserve supported visibility flags; at least one visible sheet required       |
| Row heights and non-overlapping column widths                                                                                                              | Preserve bounded supported numeric/boolean attributes; reject ambiguous overlapping column definitions |
| Plain inline/shared strings                                                                                                                                | Resolve referenced shared strings and rebuild as inline literals; discard all unused strings           |
| Rich text/phonetic runs                                                                                                                                    | Reject; no claim of formatting preservation                                                            |
| Styles, themes, number/date formats                                                                                                                        | Reject these parts and style attributes, including otherwise ordinary styled workbooks                 |
| Formulas and cached formula results                                                                                                                        | Reject every formula; never calculate, convert caches or follow links                                  |
| Merged cells                                                                                                                                               | Reject every merge; no partial merge redaction                                                         |
| Comments/notes, hyperlinks, charts/drawings, embedded objects, external links/connections, defined names, pivot tables, validation, conditional formatting | Reject unsupported parts/elements/relationships; no silent preservation                                |
| Workbook properties/custom properties                                                                                                                      | Parse within existing XML budgets, then remove all property parts from output                          |
| Sheet titles                                                                                                                                               | Replace with generic `Sheet 1`, `Sheet 2`, etc.; no copied names/headers in findings                   |
| Window/book-view settings, dimensions, row spans and XML comments                                                                                          | Not preserved; canonical output omits these non-cell carriers                                          |
| Unknown parts/elements/attributes or protected/malformed/encrypted packages                                                                                | Reject conservatively                                                                                  |

This supports plain workbooks, **not general Excel fidelity**. Even simple files
saved by Excel commonly contain styles/themes/views that this profile rejects.
Original bytes/metadata remain unchanged. Document the generic sheet names and
metadata/view removal before any future frontend confirmation flow. First-row
headers are ordinary cells; no header/name inference occurs.

## Redaction and verification contract

The only transformation is full-cell replacement with literal **`[REDACTED]`**.
Selections union category findings with all represented cells in selected columns.
Column redaction includes numeric/boolean cells that Phase 1 pattern detection
skips. `includeHeader` explicitly controls row 1 for column selection; category
selection still applies to that row. Overlapping selections count a cell once.
No arbitrary cell coordinates, values, source keys, tenant IDs, regex or code are
accepted. Empty/duplicate/invalid selections fail. Nonexistent selected columns
fail asynchronously before publication.

Only the permission-restricted, deadline-bounded compiled child parses workbook
content. It reruns bounded ZIP/XML checks and scanning, validates the strict profile,
constructs fresh output parts and a deterministic ZIP, then reopens that output.
It checks all supported rows/columns/visibility and typed values against the expected
redacted model and runs the independent Phase 1 inspector over the generated ZIP.
A mismatch returns `guard_output_verification_failed`; output is never published.
Shared strings, metadata, source labels and arbitrary package parts are not copied,
so they cannot retain alternate representations of selected source values.

The guarantee is **selected supported cells were redacted**. Unselected cells can
still contain the same original values or other sensitive data; numeric detection,
pattern false negatives and Phase 1 coverage limits remain. No claim of complete
sensitive-data removal, compliance certification or perfect detection is made.
The child returns private workbook bytes for storage, not an API preview. IPC,
crash dumps and telemetry must never capture those bytes. JS memory zeroization
and OS/native-memory isolation are not established by the local tests.

## API and safe responses

All operations use the existing tenant JWT guard, strict DTOs and private/no-store
responses. Current tenant/requester/source authorization is rechecked. Platform
JWTs and other requesters cannot generate or inspect the job. Job response shapes
are whitelisted and include no cell values, storage keys, hashes or lease tokens.

| Endpoint                                                     | Contract                                                                                                  |
| ------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------- |
| `POST /guard/scans/:id/copies`                               | `202` durable sanitization submission; `id` is an authorized completed scan                               |
| `GET /guard/jobs/:id`                                        | Existing shared status endpoint; `kind: sanitize`, real phase and safe result metadata                    |
| `POST /guard/jobs/:id/cancel`                                | Existing shared cancellation; no undo of committed copies                                                 |
| `GET /files/:id/guard/copies`                                | Requester's currently existing published copies; limit 1–50, ObjectId `after`, optional UUID `requestKey` |
| `GET /files/:id/guard/jobs`                                  | Existing recovery/history, also includes sanitization jobs and UUID recovery                              |
| `GET /files/:derivedId/download`, `DELETE /files/:derivedId` | Existing private file routes with derived lineage/deletion controls                                       |

```json
{
  "requestKey": "11111111-1111-4111-8111-111111111111",
  "categories": ["email", "payment_card"],
  "columns": [{ "sheetIndex": 0, "column": 3, "includeHeader": true }]
}
```

Categories must have been enabled in the referenced scan. At most five categories
and 100 unique column coordinates are accepted. Sheet indexes are zero-based,
columns one-based, with Phase 1 ceilings (20 sheets/512 columns). Empty category
or column arrays default to `[]`; at least one selection is required. Unknown
nested fields and row/value selectors are rejected. The original completed scan
remains `generationEligible: false`: Phase 1's limited coverage does not certify
compatibility; strict eligibility is established only inside the generation child.

Example completed response excerpt:

```json
{
  "jobId": "aaaaaaaaaaaaaaaaaaaaaaaa",
  "kind": "sanitize",
  "status": "completed",
  "phase": "completed",
  "resultFileId": "bbbbbbbbbbbbbbbbbbbbbbbb",
  "redactedCells": 7,
  "transformationScope": "selected_supported_cells",
  "generationEligible": false
}
```

Reuse the request UUID and identical canonical selections after an uncertain
response. Changed bodies or another active tenant job return 409. Scan and copy
requests share the existing tenant/requester UUID uniqueness constraint; do not
reuse a scan's UUID for a copy. Terminal failed jobs require a new UUID to retry.
Shared status/recovery works even if admission is later disabled. Safe failures
include `guard_profile_unsupported`, `guard_selection_invalid`, `guard_source_changed`,
`guard_output_verification_failed`, `guard_quota_exceeded` and existing safe errors.
Admission rate limits use the existing ten-new-jobs/minute tenant budget.

## Persistence, quota and authorization

No new collections or destructive/backfill migration is introduced. `guardjobs`
adds kind (legacy/default `scan`), scan reference, bounded selections, fixed output
file ID, internal output key/digest, cleanup-pending/retry metadata and safe redaction
count. An additive kind/active/cleanup-time/ID index supports bounded reconciliation;
it is created only in approved worker initialization. Existing UUID and active-tenant
unique indexes remain unchanged: one active Guard job per tenant across both kinds.

`CompanyFile` adds optional immutable derivation metadata: original file ID, job ID,
strategy version and creation time. The worker allocates one server-owned output
ID/key when admission commits. Existing file `_id` and unique storage-key indexes
prevent duplicate metadata for that job. New names are opaque `sanitized-<jobId>.xlsx`.
Output is private, requester-restricted; existing tenant-owner access/deletion rules
still apply. Sharing/permission expansion of derived files is blocked pending policy
review. Reads/downloads additionally require current access to the original; source
removal/restriction cannot be bypassed through the managed copy. An owner/uploader
can still delete their derived copy after original access is lost.

Normal original file behavior is preserved. Ordinary file listings filter inaccessible
lineage before serialization. Their existing `total` remains the initial visibility
match count, so derived-source revocation can produce sparse pages/overstated totals.
The dedicated cursor-based copy history omits deleted copies and remains source-scoped.
An exact lineage-aware listing/count query and performance validation are required
before frontend rollout; no forbidden filenames/IDs are returned through sparse pages.

Admission/processing/pre-storage/publication recheck current actor/company/source.
Shared user/company/file fence writes conflict with deletion/revocation transactions.
Source digest, findings and strategy version bind generation to the completed scan.
Lease token/expiry and job document writes fence every publication and cancellation;
a final failed completion match aborts the entire transaction.

Quota is **not reserved** at admission or storage write. Publication calls the existing
`EntitlementsService.recordFileUploads` with the same session as file metadata,
completed job and event. Existing subscription locking, stored-file limits, monthly
upload accounting and Premium overage behavior are reused unchanged. The current
quota/plan/payment state is checked then, including changes during processing.
A failed transaction rolls back file metadata and accounting together. Deleting a
copy reduces stored-file count without reversing existing historical upload usage.

## Recovery, compensation and lifecycle limitations

One active attempt uses the shared worker, bounded source download and child deadline.
PUT uses an abort signal and the configured IO deadline; late or failed acknowledgements
are treated as uncertain. A durable cleanup marker is committed **before PUT**.
Original storage keys are never put/deleted by Guard generation or reconciliation.

Retries use the same job-owned key and file ID. Source bytes, selectors, strategy and
output digest make reprocessing deterministic; a changed output is rejected. Expired
leases reuse Phase 1's bounded retry/recovery logic. Publication cannot create more
than one record/usage event because its lease/job/file identity and transaction are
shared. A lost successful DB acknowledgement leaves the completed job/copy intact;
terminal failure cannot overwrite an already committed completed job.

Reconciliation is gated, checks at most one inactive sanitization record per worker
pass, rotates retry time by 30 seconds and bounds deletion IO. A primary/majority
file lookup must confirm absence before deleting only the expected job-owned key.
A committed file or uncertain lookup prevents destructive compensation. Failed
cleanup keeps its durable record for retry; no provider error/key/content is logged.
Deleted completed copies are also reconciled, including metadata removal by ordinary
cleanup paths. Copy deletion records a tombstone before deleting storage/metadata.

**Remote PUT and MongoDB are not an atomic transaction.** A timed-out/stale PUT can
finish after cancellation or deletion. Cleanup tombstones deliberately remain and
repeat deletion after confirmed metadata absence. This avoids losing tracking but
does not guarantee immediate absence of every orphan. It can cause repeated idempotent
DELETE requests and retention growth. Completion of safe cleanup/expiry needs approved
storage quiescence, object-version handling, monitoring and owner retention decisions.
Do not delete job/tombstone records or apply Mongo TTL while objects/commits remain
uncertain. Disabled processing performs no reconciliation, so later disabling requires
a separately reviewed drain/recovery procedure. No quota reservation can be stranded.

No cleanup policy for published lineage copies after source/user/company deletion,
backup versions or legal holds is invented. Such copies become inaccessible through
lineage where applicable and remain subject to existing authorized file deletion.
Those policy/operational gaps block public activation, not disabled code review.

## Verification and deployment

Use Node 24 and existing backend commands; no new dependency or environment setting:

```sh
npm run build
npm run format:check
npm run lint
npm test -- --runInBand
npm run test:e2e -- --runInBand
```

Build packages the child/redactor under `dist/sensitive-data-guard/`. Do not run parser
code directly in the request process. Real HTTP tests need local `mongod` and create
only a disposable localhost replica set. Storage and entitlement admission are
controlled in Guard HTTP tests; they exercise real Mongo transactions/rollback but
are not proof of live S3 or live subscription/provider integration. The full existing
entitlement/file/billing regression suites exercise unchanged accounting behavior.
CI must supply `mongod`, otherwise the real Guard suite is explicitly skipped.

Before activation: verify the Phase 1 worker isolation boundary, private-storage abort
and late-outcome behavior, repeated cleanup cost/quiescence, database/index capacity,
corpus fidelity/compatibility, load/memory ceilings, accurate lineage listings and all
retention/deletion decisions. Run authorized deployment/provider checks separately.
Default-off deployment requires only the existing dependencies/configuration and
build/start commands; do not change either approval provider to deploy disabled code.

## Changed-file inventory

- Guard contracts and persistence: `src/sensitive-data-guard/guard.constants.ts`,
  `entities/guard-job.entity.ts`, `dto/guard-redact.dto.ts` and `guard.openapi.ts`.
- Guard orchestration and API: `src/sensitive-data-guard/guard-sanitization.service.ts`,
  `guard.service.ts`, `guard.controller.ts`, `guard.worker.ts`, `guard.runner.ts`,
  `scan-child.ts` and `sensitive-data-guard.module.ts`.
- Workbook processing: `src/sensitive-data-guard/workbook/sanitize-workbook.ts`,
  `write-xlsx.ts` and `scan-workbook.ts` (exports the existing bounded XML helper).
- Private files/storage: `src/files/entities/company-file.entity.ts`,
  `src/files/files.service.ts`, `src/aws-s3/object-storage.ts` and
  `src/aws-s3/aws-s3.service.ts`.
- Tests: `src/sensitive-data-guard/workbook/sanitize-workbook.spec.ts`,
  `src/docs/swagger.spec.ts`, `test/fixtures/guard/workbook.ts` and
  `test/guard.e2e-spec.ts`.
- Documentation: this guide, `docs/sensitive-data-guard.md`,
  `docs/sensitive-data-guard-phase1.md`, `docs/README.md` and
  `docs/stabilization-roadmap.md`.

Paths after the first Guard file in each bullet are relative to its directory.
There are 27 changed/new files. No manifests, lockfiles, frontend files,
environment files or production configuration are changed.

## Local verification — 2026-10-12

- `npm run build`, `npm run lint` and `npm run format:check`: passed.
- Backend unit suite: **61 suites / 752 tests passed**.
- Backend HTTP suite: **10 suites / 182 tests passed**, including 35 Guard cases
  against a disposable localhost MongoDB replica set. These include existing
  scan behavior and new copy lifecycle, revocation, cancellation, UUID recovery,
  quota rollback, lost storage/database acknowledgements and cleanup retry checks.
- The HTTP suite's compiled production startup smoke passed with Guard settings
  absent: healthy probes, denied scan/copy admission, no Guard collection/index
  initialization, unchanged queued work and no child/parser/content reads.
- Independently reopened a real child-generated copy with `openpyxl` from the
  existing bundled tooling (not an application dependency). Verified seven literal
  redactions, generic sheet names, hidden-sheet/row/column flags, unchanged source
  SHA-256 and absence of the selected fixture canaries from every output ZIP part.
- Documentation validation: 32 Markdown files, 232 local links/anchors, 18 npm
  script names and 68 environment-template variables checked. Changed Markdown
  formatting and `git diff --check` passed.

These checks establish local default-off review readiness, not live Render/S3
health or production worker isolation. Live providers and production infrastructure
were not accessed. The activation blockers above remain unresolved.
