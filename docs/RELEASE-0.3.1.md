# CAS FieldOps 0.3.1 — original-document acceptance fixes

Verified November 26, 2026 (America/Denver).

This release fixes defects found by following the original tracking document through complete authenticated workflows and a writable browser installation. The [acceptance record](END-TO-END-ACCEPTANCE.md) maps each requirement to its evidence and describes the failures corrected.

The fixes cover receipt/backorder and cancelled-order accounting, segregation of duties, availability approval, supplier response privacy, dated bulk crews, authoritative board capacity, spreadsheet values and change provenance, assignment/time boundaries, hosted seat reactivation and public-demo write protection. EPCC source uncertainties remain explicit.

## Validation

- 73 automated tests passed, including six new multi-step HTTP workflows and five existing HTTP boundary tests. `npm run test:e2e` reruns those eleven HTTP tests.
- TypeScript and the Vite production build passed. Dependency audit: zero known vulnerabilities.
- Browser checks exercised writable crews/time/receiving/availability, drag success and conflict rejection, every primary screen, a real offline reload with encrypted photo evidence and stale-work review, production approval and a Section 1 workbook download.
- PDF report pages were rendered and inspected; the section workbook contains exactly four Section 1 task rows.
- Billing and external event delivery use simulated-provider tests; no real charges, messages or Bidlark integration were activated.

Screenshots: [resource board](images/resource-acceptance-v031.jpg), [offline sync](images/offline-acceptance-v031.jpg). Prior release evidence remains in [RELEASE-0.3.0.md](RELEASE-0.3.0.md).

## Hosting

Source: https://github.com/ExJtac/Fieldops. Promotion: https://cas-tx.com/Tracking/. The hosted application is a synthetic read-only demonstration; writable use is self-hosted. The completed backup, migration rehearsal and live verification are recorded below.

## Hosted verification completed

Application source `c18c052ea1686469b211ba637f8f1941fee8d1eb` passed [GitHub CI](https://github.com/ExJtac/Fieldops/actions/runs/45954073169). The source is installed at `/home/deploy/cas-fieldops/releases/20261126-v031`; promotion is `/var/www/cas-fieldops/releases/20261126-v031/Tracking`.

A consistent pre-upgrade backup is retained at `/home/deploy/cas-fieldops/data/backups/pre-v031.sqlite`. The copied-database rehearsal passed with two projects, four calendars, one serialized unit, the source-scope clarification and 28 weekly capacity cells. Rehearsal and local preview processes were stopped. Prior service/scoped Caddy files are retained in `/var/backups/cas-fieldops/20261126-v031` for rollback.

The first HTTP request during service startup returned a transient 502. Once startup completed, the full live verification passed: promotion and assets, app shell/service worker, health 0.3.1, read-only workspace, capacity API, PDF/XLSX signatures, and 403 rejection of project, inventory and billing-webhook writes. Promotion HTML matched the release artifact byte for byte. Browser checks verified the new footer, exact barcode/serial lookup, capacity display and no captured console errors. [Live screenshot](images/public-v031.jpg).

Only FieldOps restarted. Bidlark, SiteScribe, CrewClock, CrewBooks, Inventory, Lumen, CAS-TX, CAS Gantt and Creator Studio process IDs were unchanged. No live Bidlark integration or customer-data workflow was activated.
