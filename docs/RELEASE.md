# CAS FieldOps 0.3 standalone release

Release verification: November 26, 2026 (America/Denver).

- Source: https://github.com/ExJtac/Fieldops
- Promotion: https://cas-tx.com/Tracking/
- Read-only synthetic demonstration: https://cas-tx.com/Tracking/app/

This release completes the standalone continuation mapped in [REQUIREMENTS-MATRIX.md](REQUIREMENTS-MATRIX.md). It adds the full material grid/history, matched landed-cost quote selection, reviewed PO/estimate intake, shared native Gantt, combined field entries, dated crews/calendars/analytics, private pricing/rate history, scoped supplier access, encrypted offline drafts, isolated workspace memberships, optional commercial entitlements/billing and signed typed-event adapters. Receipt valuation preserves purchase revisions, section reports use explicit order-line task allocations, and scoped foremen can receive materials.

## Verification

All 67 automated tests pass on Node 22. TypeScript and production Vite builds pass. The dependency audit reports zero known vulnerabilities. Billing and external delivery tests use simulated providers; no live subscription was purchased or external destination activated. [GitHub CI](https://github.com/ExJtac/Fieldops/actions/runs/45948919822) passed for deployed application source `9609fc99987ce34a02b707b09584d8113526dca6`. Documentation/screenshot follow-up commits do not change deployed application code.

Writable browser checks covered grid/history, Gantt, field entry, crew calendar/capacity, reviewed import rejection/correction/commit, workspace creation/isolation, private markup calculation/approval and supplier PO acknowledgement. An actual production offline test disconnected/reloaded/unlocked the app, queued a time/quantity entry, then reviewed a stale-task conflict and synced exactly once. The 390px phone view has no page horizontal overflow. Screenshots `docs/images/gantt-v030.jpg` and `docs/images/offline-mobile-v030.jpg` show the synthetic application. Production browser console checks found no captured errors. Prior PDF render/export evidence is retained in [0.2 release evidence](RELEASE-0.2.md).

## Deployment and recovery

The release uses its own FieldOps service, database and scoped Caddy include. The upgrade must take an online SQLite backup and rehearse additive migrations against a copy before switching the application and promotion paths. Unrelated website/application services are outside this deployment. The public demo rejects all writes; writable use requires a private self-hosted installation.

[Acceptance coverage and operating limits](ACCEPTANCE.md) document community/hosted modes, encrypted local storage, supplier/financial privacy and external configuration. Live Bidlark replication remains a separate next step. SQLite is a single-server deployment; no distributed hosting, payroll processing or external security certification is claimed.

## Hosted verification results

The migration rehearsal used `/home/deploy/cas-fieldops/data/backups/pre-v030.sqlite`, a consistent online backup of the existing synthetic database. The copied database preserved two projects, four calendars and one serialized unit; the material workspace and organization membership routes succeeded, health reported 0.3.0, and attempted writes returned 403. The rehearsal process was stopped before activation.

The active application is `/home/deploy/cas-fieldops/releases/20261126-v030`; promotion files are `/var/www/cas-fieldops/releases/20261126-v030/Tracking`. Prior service/scoped routing files remain in `/var/backups/cas-fieldops/20261126-v030`. Restore those scoped files and validate Caddy for a demo rollback; keep the matching database backup and preserve unrelated host configuration.

Live checks returned 200 for promotion, stylesheet/image, app shell/assets, service worker, health, workspace/materials/memberships, and valid PDF/XLSX reports. Promotion HTML matched the local artifact byte for byte. The public mutation check returned 403. The live Gantt rendered with no captured console errors; `docs/images/public-v030.jpg` records the actual deployed view and Fieldops GitHub link. Bidlark, SiteScribe, CrewClock, CrewBooks, Inventory, Lumen and CAS-TX service process IDs remained unchanged across this deployment. Only FieldOps restarted; only its existing scoped Caddy include was updated. Temporary local and staging preview processes were stopped.
