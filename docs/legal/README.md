# Legal and licensing review

> **DRAFT — NOT EFFECTIVE. Owner/legal review required. Do not publish as a final policy or collect agreement to this draft.**
> Operator: **TODO: legal entity**. Effective date/version: **TODO**. Contact: **TODO: approved public contact**.

## Separate scopes

1. The owner selected MIT for original repository source code. [LICENSE](../../LICENSE) uses the standard [OSI MIT text](https://opensource.org/license/mit), with 2026 supported by the available Git history. The owner confirms MIT and copyright attribution authorization for Lasha Abramishvili, Viktoria Kazarovi, and Zviadi Svanadze; this is owner-reported, not independently verified. LICENSE carries the requested three-person notice. The unresolved SVG is excluded from the MIT claim; public release remains blocked pending asset/rights review while local draft review can proceed. Third-party material retains its own license.
2. Hosted DataVault access, subscriptions, and support require separate service terms; MIT permission does not provide hosted access or an SLA.
3. Customer uploads and other customer data are not licensed under the repository's MIT license. **TODO: approve customer ownership and limited processing authority clauses.**
4. Account identifiers, authentication, usage, billing metadata, and other personal information require an operator-specific privacy notice and, where applicable, customer data-processing terms.

## Drafts

- [Terms of Service](TERMS_OF_SERVICE.md)
- [Privacy Policy](PRIVACY_POLICY.md)
- [Acceptable Use Policy](ACCEPTABLE_USE_POLICY.md)
- [Data retention](DATA_RETENTION.md)
- [Provider/subprocessor review](SUBPROCESSORS.md)
- [Licensing and publication audit](LICENSING_AUDIT.md)
- [Third-party license review](THIRD_PARTY_LICENSES.md)
- [NOTICE preparation draft](NOTICE.md)

Implementation descriptions are evidence notes, not promises of legal compliance or production configuration. No certification, jurisdiction, customer rights deadline, refund rule, backup schedule, provider retention guarantee, or incident notification deadline is established here. Resolve TODOs and ensure implemented operations can honor approved commitments before publishing.

## Publication decisions

The three-collaborator MIT and attribution authorization has been confirmed by the owner. Both private package manifests and root-package lockfile entries now declare `MIT` for authorized original source, without altering dependency licenses. `frontend/app/icon.svg` remains outside that MIT claim: the owner confirms Viktoria did not create it, and its rights are unknown.

**TODO:** resolve third-party source/asset provenance, any course/employment rights restrictions and supporting evidence needed for release; complete release-artifact notices. Replace the unresolved SVG with an original or appropriately licensed asset if its rights cannot be established, in a separately authorized change. Do not invent documentary evidence or publish policy drafts.

**TODO:** approve operator identity, contacts, governing law/dispute process, eligibility/age restrictions, customer agreement/DPA roles, payment/refunds, suspension/termination, acceptable-use enforcement, retention/deletion/backups/legal holds, rights handling, incident escalation and notices, deployment regions, actual subprocessors/contracts and international transfers. Resolve trademark/logo/documentation distribution rights separately from the original-source selection.

## Frontend integration review — no UI changes

The shared [auth page](../../frontend/components/auth/auth-page.js) renders registration and Google registration completion, and an `auth-bottom` footer. Add approved Terms/Privacy links near registration submission and in that footer after final policies have stable public URLs. The [workspace shell](../../frontend/components/layout/shell.js) has an `app-footer`; link final policies there and from platform-admin access-request/setup pages. Include AI data-handling disclosure before AI submission where the approved privacy design requires it.

No existing versioned Terms acceptance mechanism was identified. A privacy notice is not automatically consent; counsel must decide the lawful basis and whether contractual acceptance, optional consent, or acknowledgment is required. If acceptance is required, design server-side version/time evidence and accessible explicit choice in a separately approved task, including Google flows. Do not add a preselected checkbox, imply consent through a broken link, link repository drafts as final policies, or claim agreement was recorded when it was not. This update adds no frontend route, link, checkbox, or behavior.
