# Licensing and publication audit

> **REVIEW DRAFT — publication blocked by unresolved rights.** Reviewed 2026-10-11 against local revision `e30c4c7`; no commit, deploy or visibility change performed.

## Original source and contributions

No tracked root LICENSE/NOTICE/COPYING file or source SPDX/copyright license header was identified before this change. Before this licensing task, backend package/root lockfile metadata declared `UNLICENSED` and the frontend had no license field. Both private packages and their root-package lockfile entries now declare `MIT` for authorized original source only. Neither package is published by this task. The frontend's “DataVault” copyright footer is a product label, not proof of the legal rights holder.

### Collaborators and evidence

The owner identifies DataVault as a final course project created by **Lasha Abramishvili**, **Viktoria Kazarovi**, and **Zviadi Svanadze**. All three must be credited. Locally available Git history records only Lasha Abramishvili and Viktoria, with dates in 2026; the missing third Git author identity does not negate Zviadi's owner-reported collaboration. Viktoria's full name and Zviadi's participation come from the owner, not inferred emails or invented Git records.

### Confirmed owner-reported authorization

In this follow-up, the owner explicitly confirmed that MIT permission covers **all three named collaborators** and that all three authorize being named as copyright holders for their original contributions. This supports using the requested notice and source-package metadata in a local review commit. It is **owner-reported authorization, not independently verified legal ownership**. No signature, contract, assignment, employer release, CLA/DCO or documentary evidence is invented or claimed.

**TODO: assess any employment/course/institutional restrictions, third-party material and supporting rights evidence as needed before public release.** Agreement to license original contributions does not establish ownership of borrowed assets or assign all rights to a single person/entity.

### MIT attribution and scope

LICENSE now uses the exact owner-approved notice:

```text
Copyright (c) 2026 Lasha Abramishvili, Viktoria Kazarovi, and Zviadi Svanadze
```

The standard [OSI MIT terms](https://opensource.org/license/mit) remain unchanged. The 2026 year is supported by available repository history and the owner's requested notice. The three names reflect owner-reported attribution, not an independent legal-title determination.

MIT applies to authorized original backend/frontend source. Third-party code retains its own licenses; customer data and hosted SaaS terms are separate. **`frontend/app/icon.svg` is explicitly excluded from the original-source MIT licensing claim while its provenance/rights are unresolved.** No ownership or MIT permission is asserted for it. Original documentation and other material still require any applicable provenance/rights review.

### Package metadata decision

Both `package.json` files now declare `license: MIT`; their lockfiles' root-package metadata is synchronized. `private: true`, dependencies, dependency licenses, resolved artifacts, scripts and versions are unchanged. These fields classify the authorized original source; they do not relicense dependencies or the unresolved SVG. Source licensing can be recorded without claiming that the complete frontend release artifact is cleared for distribution. Public release remains blocked by the asset and remaining publication checks. Existing hosted-policy TODOs are preserved and require separate approval.

## Assets and provenance

**The owner confirms Viktoria Kazarovi did NOT create `frontend/app/icon.svg`.** Its creator, source and licensing rights remain unknown. Git history traces its addition to commit `d4e6e84354a2984bef7e7e18cc362075663a31d9` (`added initial frontend`), recorded under Git author **Viktoria on 2026-09-26**. That commit identifies who added the file, not who created the artwork. The added SVG is byte-identical to the current file; no later SVG changes were found in the locally available history. It contains a rounded rectangle and three geometric bar paths, without a copyright, license or source attribution. The existing `Logo` component in `frontend/components/ui.js` and `.logo-mark` CSS implement a related three-bar brand mark, but do not establish its creator or rights.

No asset-origin statement was found in the existing frontend README or handoff. Committing a geometric mark is not evidence of original creation, generation rights, assignment or permission to use an external design. The owner's permission covering the three collaborators does not resolve the rights of this asset's unknown creator. A repository-wide source/attribution search and limited web searches for exact SVG path fragments found no source/license attribution; absence of a search match does not establish originality or ownership. **TODO: establish the SVG's actual source and applicable rights. Recommend replacing it with an original or appropriately licensed asset before public release if provenance cannot be resolved. Do not delete or replace the existing icon without explicit permission; it is unchanged by this task.** No tracked image packs or bundled font binaries were found. CSS uses system fonts (`Segoe UI`, Arial, sans-serif, monospace); this does not distribute those font files or confer rights in them. Lucide icons are imported from `lucide-react`; its ISC notice also credits Feather MIT portions. Retain that notice in relevant distributions. Original UI/code may still contain borrowed designs/snippets not identifiable from filenames; **TODO: contributors confirm provenance.**

See [third-party review](THIRD_PARTY_LICENSES.md) for exact installed direct package versions and lockfile declarations. This audit does not establish that every dependency is MIT or that generated Docker/Next bundles comply with notice obligations.

## Public-distribution review

- Current tracked environment files are only `.env.example` and `frontend/.env.example`. Ignore rules exclude runtime credentials/builds; Docker ignores `.env*`. Ignoring a file does not remove earlier Git history or guarantee a clean release artifact.
- A path/category-only current-tree scan checked private-key markers, provider/AWS key formats and credential-bearing database URI patterns. Four URI matches are synthetic fixtures in `src/maintenance/bootstrap-diagnostics.spec.ts`, `src/maintenance/cleanup-disposable-company.service.spec.ts`, `src/payments/payment-sync-failure.spec.ts`, and `src/payments/payments-observability.spec.ts`; they exercise sanitization. No values from private local environment files were read or exposed.
- This heuristic is not a dedicated secret scanner or full Git-history audit. **TODO: run an approved history/artifact secret scan and review false positives before public distribution; rotate any genuine exposed credentials through an authorized process.** Do not rewrite history or modify secrets in this task.
- [Handoff](../../FRONTEND_HANDOFF.md), [feature audit](../../frontend/BACKEND_FEATURE_AUDIT.md), [roadmap](../stabilization-roadmap.md), and [admin maintenance guide](../admin.md) contain staging hostnames, historical operational checks and internal implementation detail. No confidential status is established by the files themselves. **TODO: owner approves public suitability and removes/redacts sensitive operational context in a separately reviewed change.** Do not distribute database exports, customer files, support logs, build reports or ignored local configuration.
- No tracked customer dataset or proprietary media library was identified by the filename/asset review; that does not certify content ownership or every historical revision.

## Release gate

All three collaborators' MIT and attribution authorization is owner-reported; local draft-review readiness is supported, with no commit performed. Before publication, resolve SVG/source/asset rights and any required independent permission evidence; review the scoped MIT metadata and notices; review actual browser/server/container artifacts and third-party notices; clear secrets/history/internal material; and complete hosted legal/privacy/retention/provider decisions. [Legal index](README.md) records those decisions and proposed UI integration. Draft policies must not be presented as adopted terms. No compliance certification, legal jurisdiction, refund policy or retention guarantee was verified.
