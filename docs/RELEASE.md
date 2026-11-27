# CAS FieldOps 0.3 standalone release

Release verification: November 26, 2026 (America/Denver).

- Source: https://github.com/ExJtac/Fieldops
- Promotion: https://cas-tx.com/Tracking/
- Read-only synthetic demonstration: https://cas-tx.com/Tracking/app/

This release completes the standalone continuation mapped in [REQUIREMENTS-MATRIX.md](REQUIREMENTS-MATRIX.md). It adds the full material grid/history, matched landed-cost quote selection, reviewed PO/estimate intake, shared native Gantt, combined field entries, dated crews/calendars/analytics, private pricing/rate history, scoped supplier access, encrypted offline drafts, isolated workspace memberships, optional commercial entitlements/billing and signed typed-event adapters. Receipt valuation preserves purchase revisions, section reports use explicit order-line task allocations, and scoped foremen can receive materials.

## Verification

All 67 automated tests pass on Node 22. TypeScript and production Vite builds pass. The dependency audit reports zero known vulnerabilities. Billing and external delivery tests use simulated providers; no live subscription was purchased or external destination activated. GitHub CI and hosted migration/public smoke checks are recorded below after verification.

Writable browser checks covered grid/history, Gantt, field entry, crew calendar/capacity, reviewed import rejection/correction/commit, workspace creation/isolation, private markup calculation/approval and supplier PO acknowledgement. An actual production offline test disconnected/reloaded/unlocked the app, queued a time/quantity entry, then reviewed a stale-task conflict and synced exactly once. The 390px phone view has no page horizontal overflow. Screenshots `docs/images/gantt-v030.jpg` and `docs/images/offline-mobile-v030.jpg` show the synthetic application. Production browser console checks found no captured errors. Prior PDF render/export evidence is retained in [0.2 release evidence](RELEASE-0.2.md).

## Deployment and recovery

The release uses its own FieldOps service, database and scoped Caddy include. The upgrade must take an online SQLite backup and rehearse additive migrations against a copy before switching the application and promotion paths. Unrelated website/application services are outside this deployment. The public demo rejects all writes; writable use requires a private self-hosted installation.

[Acceptance coverage and operating limits](ACCEPTANCE.md) document community/hosted modes, encrypted local storage, supplier/financial privacy and external configuration. Live Bidlark replication remains a separate next step. SQLite is a single-server deployment; no distributed hosting, payroll processing or external security certification is claimed.
