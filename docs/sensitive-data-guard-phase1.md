# Sensitive Data Guard — scan-only backend

Phase 1 implementation, reviewed against the working tree based on `24c3ff5`.
See the [architecture proposal](sensitive-data-guard.md) for later phases.
There is no sanitization, derived-file creation, transformed download, frontend
integration, AI processing, or billing change in this phase.

## Safety gate and deployment blocker

**Admission and the automatic worker are disabled by default.** The Nest
`GUARD_RUNTIME_POLICY` provider sets `isolationApproved: false`. A valid scan
submission receives `503 guard_runtime_not_approved`, with no new job. Existing
uploads/downloads continue normally. No environment variable or secret was added.

The child runs with Node 24 permissions, read access restricted to the compiled
Guard directory and installed dependencies, no filesystem write/child-process/
addon/worker permissions, no inherited credentials, disabled string code generation,
128 MiB V8 heap, discarded stderr, bounded input/output and a hard kill deadline.
No parser path opens HTTP/DNS, evaluates formulas, follows links or launches Excel.
However, **Node 24 permissions do not enforce network isolation and the heap cap
is not an OS/native-memory cap**. These controls are not a complete sandbox.
[Node permission documentation](https://nodejs.org/api/permissions.html).

Before enabling admission, approve and verify an OS/container worker boundary
with outbound network disabled, total memory/CPU limits, read-only runtime,
non-root execution and core dumps/telemetry content capture disabled. Review how
that boundary is applied to this child's process tree on the actual host. A
boolean provider change alone supplies no isolation. The synthetic test suite
overrides this provider to exercise functionality; it does not verify Render.
Retention and workload/privacy decisions below are also release gates.

## Implemented modules and persistence

`src/sensitive-data-guard/` contains controller/DTOs, service, access resolver,
worker, child runner, OOXML inspector, deterministic detectors, models and tests.
`AppModule` registers it; `FilesService.processingSource` reuses the existing
file-access filter. Stored bytes are retrieved through existing private download
service logic. Guard never calls storage put/delete or upload quota accounting.

The actual database is **Mongoose/MongoDB**, not Prisma. No SQL/Prisma migration
exists. Additive schemas create these collections through existing startup model
initialization:

- `guardjobs`: company/requester/source references, UUID/request fingerprint,
  categories/optional phone region, engine version, status/real phase, attempt and
  lease fencing fields, timestamps, safe error/count/coverage metadata. Internal
  fingerprints/source digest/lease token are not public.
- `guardfindings`: company/job IDs, bounded ordinal, zero-based sheet index,
  one-based row/column, category/evidence and hidden flag. No sheet/header text,
  filename, cell value, preview, detected-value hash or arbitrary error text.
- `guardevents`: tenant/job/actor IDs, controlled queued/completed/failed/cancelled
  action and timestamp; application paths append events only.

Indexes: unique `(companyId, requestedBy, requestKey)`; partial unique
`(companyId, active)` where `active: true`; status/lease/creation queue index;
requester/source/ID history; unique company/job/finding ordinal and event history.
One active scan per tenant is deliberately more conservative than the proposed
queue of ten. Existing Mongo transaction/index readiness checks apply.

Company, User and CompanyFile receive an internal `guardScanFence` counter,
excluded from selections/JSON. Existing records need no backfill: `$inc` creates
the field on first protected operation. Publication/enqueue/cancellation write
these counters inside majority transactions while rechecking membership,
activation/suspension and file visibility. Competing permission changes or
user/company/file deletion conflict with stale publication snapshots. Fence
writes disable timestamps to preserve existing visible metadata dates. Ordinary
file mutation authorization and billing are unchanged.

No derived-file fields or relationships were introduced. Mongo does not supply
foreign-key cascades: access is revalidated rather than trusting saved references.

## API

All routes require a **tenant JWT** and return `Cache-Control: private, no-store`.
Platform JWTs cannot authorize them. Findings/status/history are requester-only,
even for another tenant owner's job, and require current source read access.
Cross-tenant/requester/source denials return non-enumerating 404; invalid or
suspended authentication returns 401 through the existing guard.

| Route                           | Behavior                                                                                          |
| ------------------------------- | ------------------------------------------------------------------------------------------------- |
| `POST /files/:id/guard/scans`   | `202` durable scan submission, when runtime approved                                              |
| `GET /files/:id/guard/jobs`     | Own jobs; `limit` 1–50 (default 20), ObjectId `after`, optional UUID `requestKey` recovery filter |
| `GET /guard/jobs/:id`           | Safe status/processing metadata                                                                   |
| `GET /guard/scans/:id/findings` | Completed scan only; `limit` 1–100 (default 50), numeric ordinal `after`                          |
| `POST /guard/jobs/:id/cancel`   | `200` idempotent cancellation; completed work remains completed                                   |

Strict DTOs reject tenant injection, unknown categories/fields and unbounded
pagination. Identifiers are validated Mongo IDs/UUIDs. Example submission:

```json
{
  "requestKey": "11111111-1111-4111-8111-111111111111",
  "categories": ["email", "phone", "payment_card", "iban", "ip"],
  "phoneRegion": "US"
}
```

Reuse the same UUID after a lost acknowledgement. The same source/categories/
region returns the existing job, including terminal outcomes; a changed body
returns `409 guard_request_conflict`. A different request while a tenant scan is
active returns `409 guard_active_scan_exists`. Retrying a known failed scan needs
a new UUID. A completed scan does not certify absence of sensitive information.

Safe response excerpts (additional timestamps/engine metadata are included):

```json
{
  "jobId": "aaaaaaaaaaaaaaaaaaaaaaaa",
  "status": "processing",
  "phase": "scanning",
  "progress": { "processedCells": 0, "totalCells": null },
  "findingCount": 0,
  "coverage": "pending",
  "generationEligible": false
}
```

```json
{
  "findings": [
    {
      "ordinal": 0,
      "sheetIndex": 0,
      "row": 17,
      "column": 3,
      "category": "payment_card",
      "evidence": "checksum_valid",
      "hidden": false
    }
  ],
  "nextCursor": null
}
```

Safe error strings are returned through standard Nest HTTP error shapes.
Unsupported input formats return 400; oversized metadata returns 413; durable
admission rate is ten new jobs per tenant per minute (429). Worker failures persist
only enum codes such as `guard_invalid_workbook`, `guard_limit_exceeded`,
`guard_timeout`, `guard_access_revoked`, `guard_storage_unavailable`,
`guard_worker_unavailable`, or `guard_internal_error`. No parser/provider error
message is forwarded. Database submission uncertainty uses UUID recovery;
no destructive compensation is needed because scans create no storage objects.

## Processing and limits

The long-lived Nest process polls MongoDB every two seconds, running at most one
scan at a time per process. Multiple replicas use conditional claims with random
lease tokens. There is one active job per tenant across replicas. A 120-second
lease is checked each second along with current authorization. Downloads have a
15-second deadline and the child has a 30-second deadline. Cancellation/revocation
kills the child or destroys the stream; a pending storage acquisition is bounded
by its deadline and any late stream is closed. Already transmitted HTTP responses
cannot be withdrawn, and browser disconnect does not cancel durable work.

States are queued → processing → completed/failed/cancelled. Actual phases are
queued/fetching/scanning/completed/failed/cancelled. Cell counters become available
after parsing; no fabricated percentage is emitted. Expired processing leases
requeue after restart; after three claimed attempts they fail safely. Transactional
publication requires the current lease token and authorized source, publishes
findings/completion/event together, and cannot overwrite cancellation or another
claim. A late expired worker cannot publish. Recovery also records safe events.

Limits are a frozen default Nest `GUARD_LIMITS` provider, configurable by a reviewed
provider override, **not new environment variables**. The child accepts only
positive limits at or below these ceilings. Raise ceilings only after a reviewed
code change and corpus/load tests.

| Resource                    | Default maximum                                                       |
| --------------------------- | --------------------------------------------------------------------- |
| Compressed source           | 10 MiB, also subject to existing upload ceiling                       |
| Actual ZIP expansion        | 32 MiB total; 8 MiB/entry; 100:1 ratio                                |
| ZIP entries                 | 500                                                                   |
| Worksheets                  | 20                                                                    |
| Populated/represented cells | 100,000 aggregate                                                     |
| Row/column coordinates      | 100,000 rows; 512 columns                                             |
| Cell/shared-string text     | 8 KiB                                                                 |
| XML                         | depth 64; 64 attributes/tag; 1,000,000 nodes/part; bounded attributes |
| Findings                    | 5,000; overflow fails, without publishing partial results             |
| Child output                | 2 MiB safe JSON                                                       |

ZIP preflight precedes cell parsing: strict names, central/local headers, measured
expansion/entry sizes, CRC, duplicate/case-colliding/overlapping paths, and required
OOXML parts. Initial scope rejects ZIP64, multi-disk, encryption, symlinks,
traversal, non-XML/binary content, macros/embeddings/ActiveX, external relationships,
invalid XML/DTD/custom entities and protected/ambiguous workbooks. ZIP directories and
nonstandard part paths may also be rejected by this conservative profile.

The scanner uses SAX-style XML inspection, **not ExcelJS or round-trip rewriting**.
Every accepted XML part is checked for well-formedness/resource bounds; cell
inspection follows workbook relationships, shared/inline/rich strings and actual
coordinates without allocation from declared sheet dimensions. Hidden/very-hidden
sheets, hidden rows/columns and first-row headers are included. Formulas/caches
are inventoried but neither evaluated nor pattern-scanned. Unsupported XML parts,
merges, defined names and unsupported worksheet features produce controlled flags.

All successful results currently have **limited, cell-text-only coverage**:
sheet names, properties, comments, style literals, formula text/caches and other
non-cell carriers are not detected. Unreferenced shared strings are flagged but
not returned. No result is eligible for generation in this phase. Exact Excel
fidelity and sanitization compatibility must be proven separately in Phase 2.

## Detectors and limitations

Dependencies are pinned: yauzl 3.4.0 (MIT), saxes 6.0.0 (ISC),
libphonenumber-js 1.13.15 (MIT), validator 13.15.35 (MIT). Preserve their notices;
this is not a claim that every repository dependency uses MIT.

- Email: bounded tokens validated by validator email syntax; `format_valid` does
  not prove deliverability. Obfuscation, unsupported representations and values
  split across cells can be missed.
- Phone: libphonenumber-js full validation metadata. Requires a `+` international
  representation or explicitly supplied ISO country for national text; no company
  country inference. It cannot prove ownership or distinguish all valid-looking
  order/account numbers when a country is supplied.
- Cards: text candidates of 13–19 digits with permitted separators, Luhn and
  trivial repeated-digit rejection; `checksum_valid` does not prove issuance.
- IBAN: validator country/format and checksum rules; checksum validity does not
  prove a bank account. The library version pins the included rule set; new
  formats can require an update.
- IP: bounded tokens validated by Node `net.isIP`; IPv4/IPv6, without generalized
  URL/port/CIDR extraction. Valid addresses need not identify a person.

Only typed **text** cells are pattern-scanned. Ordinary numeric/date/boolean
cells and numeric formula caches are skipped to avoid rounded IDs and number
false positives. This misses sensitive identifiers stored as numbers; it is an
explicit limitation. Sampling is bounded to 2,048 tokens and 100 extracted
numeric/IBAN candidates per cell. Findings deduplicate category/location, not
individual occurrences; counts are cell/category counts. No probabilistic scores
are invented. National IDs and custom-column redaction are deferred.

## Verification and operations

Build before running worker/runner tests or developing the Guard child:

```sh
npm ci
npm run build
npm test -- --runInBand
npm run test:e2e -- --runInBand
npm run format:check
npm run lint
npm audit --audit-level=high
```

The worker always uses the compiled `dist/sensitive-data-guard/scan-child.js`,
including API watch mode. Rebuild after parser edits; missing build or Node <24
fails safely. Node 24 is the required runtime. The real Guard HTTP suite requires
`mongod` on PATH, creates an ephemeral localhost replica set/temp directory and
removes only that synthetic test database afterward. It never reads `MONGO_URI`.
Without `mongod` that suite is explicitly skipped; CI must supply it for a complete
security gate. Existing HTTP suites remain isolated mocks. S3 is controlled in
Guard tests, so live provider/deployment behavior is not verified.

Before any separately authorized deployment:

1. Review the additive schemas/indexes and shared fence fields. Confirm replica
   set transactions, permissions to create indexes, startup index initialization
   and database capacity. No destructive/backfill migration is required.
2. Build with Node 24 and install pinned dependencies; package the compiled child
   and dependencies. Benchmark limits and runtime overhead on the intended host.
3. Establish and verify the isolation boundary above, then separately approve
   runtime-policy activation. Do not silently enable the current gated provider.
4. Approve retention/deletion for scan jobs/findings/events/idempotency records,
   tenant/user/source removal, backups and legal holds, and implement the approved
   cleanup policy before public activation. No TTL or invented deletion period
   is adopted here. Raw workbook bytes live only in bounded attempt memory and
   are released on completion/kill; JS does not promise immediate zeroization.
5. Run real replica-set race/restart tests plus authorized private-storage and
   deployment checks. Verify content-free logs/telemetry/core dumps and shutdown.
6. Review truthful product/privacy language and workload admission limits.
   Sanitization and frontend integration require separate phases/approval.

## Local verification record (2026-10-11)

- Backend build and `format:check`: passed.
- Full backend units: 59 suites / 728 tests passed; final changed scan/Swagger
  coverage: 4 suites / 50 tests passed (includes the added IBAN-context case).
- Final complete HTTP suite: 10 suites / 161 tests passed, including 14 real
  replica-set Guard lifecycle/security tests. S3 remains controlled, not live.
- Earlier HTTP run: two failures (upload socket and Stripe signature); both
  affected suites passed isolation reruns and final full suite passed.
- npm dependency audit: zero vulnerabilities.
- Documentation validation: 31 Markdown files, 222 local links/anchors, 18 npm
  script references, 68 environment-template variables passed including this record.
- Exact repository npm lint script: passed without the command wrapper
  (`rtk proxy npm run lint` in this session). Wrapper attempts exhausted memory
  at both 2 and 4 GiB; the direct repository-scoped ESLint check also passed.

No frontend tests/build, live S3, deployed sandbox, or production migration was
run. A disposable real replica set verified model index initialization and
transaction behavior; this does not establish production database capacity.
