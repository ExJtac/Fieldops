# CAS FieldOps 0.3.2 — completed original-document audit

Verified November 26, 2026 (America/Denver). This release includes the [0.3.1 workflow repairs](RELEASE-0.3.1.md) and corrects a final shared-substitute allocation case discovered during the same audit.

When a later BOM revision added a requirement for a part already serving as a substitute, the same stock could previously cover both requirements. The new authenticated regression reproduced a false Ready status for ten physical units against twenty required units. Readiness now allocates each physical unit once across approved compatible requirements, including redistributing scarce equivalents when needed. Coverage exposes its source quantities. Fractional and very small quantities also have regression coverage.

All 75 automated tests pass (seven complete new HTTP workflows, five existing HTTP boundary tests and the domain/provider/recovery suites). TypeScript and production builds pass. Dependencies are unchanged from the zero-vulnerability 0.3.1 audit. The [original-document acceptance record](END-TO-END-ACCEPTANCE.md) contains requirement-level coverage, writable browser evidence and provider limits.

The standalone source remains [ExJtac/Fieldops](https://github.com/ExJtac/Fieldops). [Promotion](https://cas-tx.com/Tracking/) and the [synthetic read-only demo](https://cas-tx.com/Tracking/app/) are separate from writable self-hosted installations. Live Bidlark integration remains deferred. Deployment verification is appended after the staged upgrade completes.
