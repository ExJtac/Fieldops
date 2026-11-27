# CAS FieldOps 0.3.2 — completed original-document audit

Verified November 26–27, 2026 (America/Denver). This release includes the [0.3.1 workflow repairs](RELEASE-0.3.1.md) and corrects a final shared-substitute allocation case discovered during the same audit.

When a later BOM revision added a requirement for a part already serving as a substitute, the same stock could previously cover both requirements. The new authenticated regression reproduced a false Ready status for ten physical units against twenty required units. Readiness now allocates each physical unit once across approved compatible requirements, including redistributing scarce equivalents when needed. Coverage exposes its source quantities. Fractional and very small quantities also have regression coverage.

All 75 automated tests pass (seven complete new HTTP workflows, five existing HTTP boundary tests and the domain/provider/recovery suites). TypeScript and production builds pass. Dependencies are unchanged from the zero-vulnerability 0.3.1 audit. The [original-document acceptance record](END-TO-END-ACCEPTANCE.md) contains requirement-level coverage, writable browser evidence and provider limits.

The standalone source remains [ExJtac/Fieldops](https://github.com/ExJtac/Fieldops). [Promotion](https://cas-tx.com/Tracking/) and the [synthetic read-only demo](https://cas-tx.com/Tracking/app/) are separate from writable self-hosted installations. Live Bidlark integration remains deferred.

## Deployment verification

Application source `ff47e398b4028b50f64e99785938ff18d8fd127a` passed [GitHub CI](https://github.com/ExJtac/Fieldops/actions/runs/45955135979). The hosted build was installed at `/home/deploy/cas-fieldops/releases/20261126-v032`; its `RELEASE-SOURCE` matches that commit. A consistent pre-upgrade SQLite backup is retained at `/home/deploy/cas-fieldops/data/backups/pre-v032.sqlite`. A separate copy passed staging checks on port 4338 before activation, including read-only enforcement, two projects, four calendars and the synthetic catalog extension.

Only the FieldOps service and its scoped Caddy include changed. Prior configuration is retained at `/var/backups/cas-fieldops/20261126-v032`, and the prior application release remains available. Startup health was checked before the route reload. Other hosted application processes, including Bidlark, retained their existing process IDs and active status.

Live checks passed for version 0.3.2, promotion HTML and assets, application shell, service worker, 28 daily resource-capacity cells, PDF and XLSX exports. Project, inventory and billing-webhook mutations all returned 403 in the public demo. Promotion HTML matched the release artifact. The browser displayed v0.3.2 with no captured console errors; evidence is `images/public-v032.jpg`.
