# DataVault stabilization and upload reconciliation

Reviewed 2026-10-10. Baseline: contributor commit `bea1495`. Alternative:
`stash@{0}` (`backup: Codex multi-file upload implementation`). The stash was
read through its Git trees, including its empty untracked parent; no stash was
applied or removed. Added helper/tests/docs were present in its tracked tree.

## Reconciled upload behavior

Both implementations reuse sequential, single-file `POST /files` calls. The
contributor remains the baseline. Its wider dialog, file icons, queue styling,
slot accounting, overage warning, batch visibility copy, capacity preflight,
and stop-on-capacity/outage behavior are preserved.

| Feature                   | Contributor at bea1495                                                                   | Stashed Codex alternative                                     | Reconciled result                                                                      |
| ------------------------- | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Multiple selection/drop   | Both supported                                                                           | Both supported                                                | Preserved                                                                              |
| Plan limits               | Reject oversized selections, track local successes, fresh preflight, backend enforcement | Only full-vault UI guard; relies on per-file backend checks   | Contributor checks retained; cancellation covers preflight                             |
| Individual progress       | Active filename percentage plus batch progress                                           | Named per-file progressbar and waiting-for-confirmation state | Contributor display plus named per-file progressbar and confirmation state             |
| Partial outcomes          | Retains successes; stops for 401/403/429/503 or uncertain network outcome                | Retains successes; continues except cancellation/401/429      | Contributor stop rules retained; generic 5xx now also stop as uncertain                |
| Failed retries            | Retries failed/ready entries, including 5xx                                              | Only definite 4xx rejections retry                            | Retry definite rejection/ready entries only; never replay success/uncertain            |
| Cancellation              | Stops current XHR and later files; preflight request continues                           | Abort applies to upload queue                                 | One controller covers preflight and all uploads; later files remain ready              |
| Duplicate submit          | Button disabled after render; no synchronous guard                                       | Synchronous controller guard                                  | Guard starts before quota read and lasts the whole run                                 |
| Duplicate selection       | Repeated selections added again                                                          | Name/size/last-modified deduplication                         | Deduplicated before capacity counting and within state updates                         |
| Uncertain outcomes        | Abort/network marked uncertain; 5xx retryable; uncertain row removable                   | All non-4xx errors uncertain; no removal/replay within dialog | Non-4xx uncertain; no removal/reselection; keeps dialog open while uncertainty remains |
| Permissions/accessibility | Labels, native modal, batch live progress; permissions editable while uploading          | Disabled permissions, row status announcements                | Contributor labels/modal plus disabled permissions and per-row live status             |
| Mobile/style              | Wide scrollable dialog, file icons, wrapping, solid sticky header                        | Narrower list layout and scoped sticky header fix             | Contributor style preserved; desktop/mobile screenshots checked in verification        |
| Backend security          | Existing validation/RBAC/tenant/quota/storage code unchanged                             | Same backend; additional HTTP regression                      | No production backend changes; additional regression reused                            |
| Tests                     | Browser selection, capacity, partial retry, single upload and plan replacement           | Queue unit tests, more browser cases, partial-batch HTTP test | Contributor tests retained/adapted; safety units and adapted browser/HTTP cases added  |

Selections containing any empty or unsupported file still reject the entire
selection, as in the contributor baseline. The stashed per-entry invalid-file
UI and alternate queue runner/layout were deliberately not imported.

Only explicit HTTP 4xx rejection responses are eligible for retry. Network
failures, timeouts, cancellation, and HTTP 5xx responses might follow a
committed upload. Their rows instruct the user to check the vault and are
excluded from retry, removal and reselection within this dialog. Remaining
ready files can still be submitted; the dialog stays open while an unconfirmed
row exists. Closing the dialog and re-uploading remains a manual decision,
not an exactly-once guarantee. No durable server idempotency was added.

The deduplication key is filename, size and last-modified time. It prevents
accidental repeated selection, not same-content duplicates across sessions,
and may treat different files with identical metadata as the same selection.
XHR progress measures transfer to the frontend gateway; 100% is followed by a
server-confirmation state and does not claim storage has completed.

Backend auth derives tenant/uploader identity; validation, restricted-user
checks, transactional quota enforcement and metadata/usage recording remain
unchanged. Definite database failures attempt storage compensation. Unknown
commit results and failed compensation still need reconciliation. No zero-orphan
guarantee is claimed during infrastructure failures.

## Files changed in reconciliation

- `frontend/components/files/files-workspace.js`: selective safety/progress and
  accessibility edits to contributor code; no whole-file stash replacement.
- `frontend/lib/upload-safety.mjs`: small deduplication and outcome helpers,
  adapted from stashed logic; the alternate upload loop was not introduced.
- `frontend/app/globals.css`: only a neutral permissions-fieldset reset.
- `frontend/tests/workspace.spec.js`: retain contributor coverage, adapt its
  retry fixture to a definite 403, and add compatible stashed/new regressions.
- `frontend/tests/upload-safety.test.mjs`: Node unit tests adapted to the helpers.
- `frontend/package.json`: `test:unit` command; no new dependency.
- `test/files.e2e-spec.ts`: stashed partial-batch storage/quota/isolation test.
- `docs/stabilization-roadmap.md`: preserved broader roadmap and threat-model
  design gate, updated upload comparison and verification.

## Existing feature status

| Area                 | Existing implementation                                                                                                                                                    | Remaining work                                                                                     |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| Files                | CSV/XLS/XLSX structural/content validation, private tenant keys, streamed downloads, company-wide/restricted visibility, uploader/owner mutation permissions               | Live batch smoke check; infrastructure reconciliation review                                       |
| Admin files          | Dedicated platform-admin authentication, safe uploader/company metadata, filename/uploader search, company/user/type/access filters, bounded server pagination and sorting | Task 2 implemented locally; real MongoDB query-performance smoke check pending                     |
| Company file view    | Names, sizes/types, dates, uploader lookup, loading/empty/error states                                                                                                     | Server-side filters and pagination UX; current filtering/sorting uses fetched collections          |
| Email                | Provider-neutral SMTP/Nodemailer and Resend senders, activation/resend/reset flows, local tests, Brevo settings in README                                                  | Run email/activation suites and an authorized real-delivery check                                  |
| AI                   | OpenRouter primary and Gemini fallback, tool calling, server-controlled models, usage, timeouts, draft/error recovery, immediate loading UI                                | Accessible loading refinements; model-specific streaming research and compatibility checks         |
| Documentation        | Extensive backend/frontend READMEs, frontend feature audit and handoff                                                                                                     | Canonical topic docs and consistent links; distinguish dated live checks from current verification |
| Agent guidance       | Root/frontend AGENTS.md, frontend CLAUDE.md references AGENTS.md                                                                                                           | Root CLAUDE.md and shared requirements referencing canonical docs                                  |
| Licensing            | Backend package is private and UNLICENSED; no license file found                                                                                                           | Owner decides proprietary SaaS versus open-source distribution; legal review                       |
| Sensitive Data Guard | File validation only; no dedicated inspection/redaction policies or workflow found                                                                                         | Architecture, threat model, approval, then controlled implementation                               |

Platform administrators and company owners are separate identities. Existing
platform file listing exposes projected metadata; do not infer unrestricted
download/deletion authority from permission to list metadata. Company-file
access remains scoped by company and visibility.

## Prioritized phases

Complexity is relative, not a delivery-date commitment. Each row should be a
separate reviewable change, with relevant tests passing before the next step.

| Order | Work and likely files                                                                     | Complexity / dependencies                                                                             | Main risk                                                                       | Acceptance gate                                                                                                                                                 |
| ----- | ----------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1     | Multiple uploads: contributor dialog, safety helpers, unit/browser/HTTP tests             | Medium; existing endpoint                                                                             | Replay after uncertain commits, partial quota exhaustion                        | Multi-select/drop, individual results/progress, retry rejection only, stop/continue, duplicate guards, preserved single upload and security                     |
| 2     | Admin Files (Task 2): admin DTO/service, dedicated admin UI, tests; completed locally     | Medium; clarify each admin scope before queries                                                       | Cross-tenant access or excessive identity disclosure                            | Server-side name/uploader search, authorized user/company filters, stable pagination/sort, scoped download/delete regression tests                              |
| 3     | Transactional email: email/auth tests and existing README configuration                   | Small–medium; authorized recipient/environment for live check                                         | Credential exposure, token reuse, account enumeration                           | Signup/activation/resend/reset failures and successes verified; real delivery reported separately                                                               |
| 4     | AI loading: assistant components/styles, provider clients only if needed, AI tests        | Medium; official OpenRouter streaming/reasoning research and configured-model capability verification | Breaking tool loops/fallback, misleading progress, private reasoning disclosure | Immediate accessible feedback, reduced-motion support, timeout/cancel recovery, preserved tools/fallback; only actual public processing states                  |
| 5     | Documentation: docs topics, root/frontend README links, AGENTS.md, root CLAUDE.md         | Medium; confirmed implementation                                                                      | Contradictory guidance, outdated integration claims                             | Overview/architecture, environment placeholders, auth/RBAC/tenancy, storage, Stripe, OAuth, SMTP, AI, Swagger, test/deploy/troubleshooting coverage             |
| 6     | License and legal readiness: distribution-decision note and clearly labeled drafts        | Small–medium; owner/legal decisions                                                                   | Unintended license grant or unsupported legal claims                            | Compare proprietary licensing with open-source options without selecting a license automatically; Terms/Privacy/license reviewed by owner/legal                 |
| 7     | Sensitive Data Guard architecture and threat model under docs                             | Large; owner policy, privacy, retention and deployment decisions                                      | Sensitive data leakage, hostile workbooks, incomplete sanitization              | Architecture/security review and approval before significant schemas or external integrations                                                                   |
| 8     | Optional Guard policies/import, scan/review/redaction, audit and RBAC in separate changes | Large; approved row 7                                                                                 | False positives/negatives, destructive workbook edits, tenant leaks             | Deterministic structured checks, validated policy import, explicit workbook coverage/limitations, sanitized-copy validation, malicious-file and isolation tests |
| 9     | Final release verification using repository CI and deployment checks                      | Medium–large; implemented phases and authorized environment                                           | Treating mocks as live integration evidence                                     | Formatting/lint/build/unit/HTTP/browser/security checks plus auth/RBAC/tenancy/storage/email/AI regressions; exact outstanding live checks recorded             |

## Sensitive Data Guard design gate

No Guard implementation is authorized by this document. The design phase must
research mature DLP/PII approaches, including Microsoft Presidio, using primary
sources. Select deterministic detectors for known identifiers, payment-card
checks, credentials, exact forbidden values, header selectors and organization
patterns; evaluate statistical/semantic detection separately. Benchmark false
positives and false negatives. LLM detection is optional supporting evidence,
not a universal detector or authority to release a file.

The proposal must define:

- Per-company policy permissions, immutable scan policy versions, worksheet and
  cell finding access, preview retention, scan/redaction/download/delete RBAC.
- Validated Excel or equivalent rule templates: rule ID, category, worksheet
  scope, header selector, match type/value, warn/block/redact action, enabled,
  notes, allowlists/exclusions. Spreadsheet cells are data, never instructions.
- XLSX byte/decompression/entry/cell/time limits, regex complexity protection,
  archive traversal rejection, parser isolation, and resource exhaustion tests.
- Coverage for formulas and cached results, hidden sheets, comments, document
  properties, hyperlinks, external links and embedded objects. Unsupported
  areas must produce explicit coverage gaps, blocking a full sanitization claim.
- Original-versus-sanitized-copy handling, formatting/structure preservation,
  formula consequences, output workbook validation and post-redaction checks.
- No sensitive cell values in logs, telemetry, errors, audit summaries or AI
  prompts. Masked findings and least-privilege preview access by default.
- Threats from cross-tenant IDs, malicious policies/workbooks, authorization
  bypass, stale policies, prompt injection, leaked previews and incomplete
  redaction; mitigations and negative tests for each.
- Explicit privacy policy and user authorization before any sensitive file
  content reaches an external AI processor; retention and data-location review.

## Reconciliation verification

Completed on 2026-10-10:

| Check                                                         | Result                                         |
| ------------------------------------------------------------- | ---------------------------------------------- |
| Backend `npm test -- --runInBand`                             | 56 suites, 688 tests passed                    |
| File HTTP `npm run test:e2e -- --runInBand files.e2e-spec.ts` | 18 tests passed                                |
| Frontend `npm run test:unit`                                  | 7 safety-helper tests passed                   |
| Upload Playwright suite                                       | 15 tests passed                                |
| Backend format check, ESLint, Nest build                      | Passed                                         |
| Frontend webpack production build (includes TypeScript step)  | Passed                                         |
| Changed frontend/docs Prettier and Git whitespace check       | Passed                                         |
| Desktop/mobile partial-results screenshots                    | Visually checked; contributor layout preserved |

The upload browser command, from `frontend/` with a local server on port 3000:

```sh
npm test -- tests/workspace.spec.js --grep 'file upload sends|batch|multiple uploads|multiple selected|replacement upload|oversized selection'
```

The first full backend run passed 687 tests but the sandbox blocked the
Swagger test's local listener. The authorized rerun passed all 688 tests.
Local HTTP listeners and Chromium required sandbox escalation. Adapted browser
fixtures now use real disk files to preserve modification times on reselection;
synthetic buffers construct a new File timestamp on each selection. Assertions
also account for the contributor button's changing pending-file count.

Safety unit tests cover metadata deduplication and rejection/uncertainty
classification. Browser tests intercept APIs and use synthetic users. HTTP
fixtures exercise Nest auth, validation, quota serialization and storage
compensation with isolated database/storage substitutes. These checks do not
certify live MongoDB replica-set transactions, S3, SMTP, Stripe or AI providers.
The full frontend suite, remaining HTTP suites, dependency advisory checks and
production/staging integration tests were not run for this scoped reconciliation.
The UI detector reported only pre-existing global CSS advisories for a width
transition and decorative grid background, outside changed declarations.

Changes are ready for a scoped commit following owner review. No commit, push,
deployment, secret change, stash application/deletion, or admin Files task was
performed. The next roadmap item remains pending; Phase 3 implementation still
requires architecture/security approval.

## Phase 1 Task 2 — Platform admin Files

Local verification on 2026-10-10:

| Check                                                       | Result                                   |
| ----------------------------------------------------------- | ---------------------------------------- |
| Admin service/security and file service unit tests          | 3 suites, 43 tests passed                |
| Admin and file HTTP regression tests                        | 2 suites, 50 tests passed                |
| Admin Files and existing admin UI Playwright tests          | 5 tests passed                           |
| Backend formatting check, ESLint, and Nest build            | Passed                                   |
| Frontend webpack production build and changed-file Prettier | Passed                                   |
| Git whitespace check and admin UI detector                  | Passed; detector returned no findings    |
| Desktop and 390px mobile screenshots                        | Visually checked; table scroll contained |

Browser tests used an ephemeral configuration with `http://127.0.0.1:3000`
because an unrelated application's IPv6 localhost listener occupied the same
port. That application was left running and repository test configuration was
not changed. The frontend package has no separate lint command; its production
build and formatting checks passed. The full repository suites were not rerun
for this scoped task.

Task 1 was already committed as `84478b3` when Task 2 began, with a clean
working tree. Its upload implementation and the earlier roadmap were preserved.
The reconciliation verification above records the earlier task, not current
Task 2 production verification.

The platform Files endpoint already had filename/company/type/access filters,
bounded pagination, stable sorting, explicit metadata projection, and a separate
platform-admin guard. The UI displayed only filename, format, and date; uploader
and company relationships, filter controls, and recoverable list errors were
missing. The platform-admin role authorizes metadata across companies. Company
owners and members cannot use this endpoint. Supplied company IDs only filter
that already-authorized scope; they never confer authorization.

Task 2 adds literal case-insensitive uploader name/email search and an exact
uploader ID filter. Results include only uploader name/email/ID and company
name/ID alongside existing file metadata. Missing relationships remain visible
with fallback labels; a cross-company uploader reference returns no joined
identity. No storage keys or user credentials are projected. Except when
uploader search requires a join before filtering, identity/company joins run
only for the selected page. Existing query limits and the five-second database
timeout remain in place. No schema or dependency changes were needed.

The Files UI shows name/type, size, upload time, uploader identity, company,
existing access visibility, and user-file drilldown. Separate filename/uploader
searches combine with searchable, bounded user/company selectors, format/access
filters, sorting, and page size. Selected users can also open their files from
the Users tab. Loading, empty, retryable error, and expired-session states are
explicit. Requests are aborted on filter changes/unmount; obsolete responses
cannot replace newer results. The responsive table scrolls within its own
keyboard-accessible region.

Download, deletion, and access mutations still use the existing company
workspace and tenant authorization. Platform administration remains a metadata
directory; no new file-content or deletion privilege was added. The company
workspace's separate collection filtering remains outside Task 2.

Verification uses isolated HTTP database/storage substitutes and browser API
fixtures. Live MongoDB query plans and production-scale substring-search
latency have not been measured. Unanchored case-insensitive substring searches
may scan many records, especially uploader joins without a company filter;
review query plans before large-scale rollout. The selectors show up to 25
server-filtered matches and explain how to narrow them. No SMTP, S3, billing,
AI provider, production integration, push, deployment, or Phase 3 work occurred.
