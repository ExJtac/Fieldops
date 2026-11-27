# CAS FieldOps 0.2 standalone release

Released November 26, 2026 (America/Denver).

- Product page: https://cas-tx.com/Tracking/
- Read-only demonstration: https://cas-tx.com/Tracking/app/
- MIT source: https://github.com/ExJtac/cas-fieldops
- Deployed application source: `6941d944c37b8ddb943630b89b76a745e1897c38`.
- CI: https://github.com/ExJtac/cas-fieldops/actions/runs/45942341023 — passed on Node 22.

## Completed verification

All 47 automated tests passed locally. Production TypeScript/Vite builds passed, including the `/Tracking/app/` deployment prefix. GitHub Actions passed for the deployed source. The production dependency audit reported zero known vulnerabilities; ExcelJS's UUID dependency is overridden to the compatible patched 11.1.1+ series, with workbook import/export exercised by tests.

The new tests cover project grants and published-summary isolation; stale import tokens and reviewed conversions; PO amendment version/receipt limits; split shipment quantity and receipt limits; bounded return credits; serialized custody and approved damage; quarantined receipt inspection/returns; calendar range atomicity and overtime policy conflicts; explicit leveling/undo/stale edits; material-constrained scenarios; explicit baseline revisions; worker time review; permissioned validated payroll; timer draft accounting; production corrections; event retry/dead-letter/deduplication; restricted HTTP history/export; retention confirmation; and PDF/XLSX outputs. The original inventory, time, tenant, authentication and backup/restore regressions remain passing.

Browser verification on the writable local app saved and approved a PO freight amendment, saved a worker shift calendar, previewed a two-shift assignment range with zero conflicts and saved it, ran detailed reports and downloaded a PDF. The PDF was rendered and visually checked. A 390px phone layout had no page-level horizontal overflow; wide tables scroll inside their panels. The latest public demo was opened after deployment, and its expanded Operations center rendered without captured browser console errors. Screenshots in `docs/images` show the actual synthetic application.

The server migration rehearsal used a consistent online backup of the existing demo database, started the new application against a separate copy, confirmed version 0.2.0, two preserved projects, four added calendars and one synthetic serialized unit, and verified HTTP writes are rejected. The public demo upgrade then preserved the original database and added only the labeled synthetic v0.2 examples.

Public verification returned HTTP 200 for the product page, stylesheet, screenshot, app shell, generated JS/CSS, health and workspace endpoints. The product HTML matched the local promotion artifact byte for byte. The workspace reported read-only mode with the expanded examples; XLSX and PDF downloads returned valid file signatures/MIME types. A public mutation returned HTTP 403. Bidlark, SiteScribe, CrewClock, CrewBooks, Inventory, Lumen and CAS-TX service process IDs were identical before and after the release. Only FieldOps was restarted; only its scoped Caddy include changed.

## Recovery and operating boundaries

The active application is `/home/deploy/cas-fieldops/releases/20261126-v020`; promotion files are under `/var/www/cas-fieldops/releases/20261126-v020/Tracking`. The dedicated `cas-fieldops` service remains loopback-only on port 4328, with CPU/memory limits and a separate synthetic database. The consistent pre-upgrade database backup is `/home/deploy/cas-fieldops/data/backups/pre-v020.sqlite`. Prior FieldOps service and scoped routing files are retained under `/var/backups/cas-fieldops/20261126-v020`.

To roll back this read-only demo, restore only its saved service/scoped include, validate Caddy, and restart/reload only those services. Preserve unrelated site changes. For a writable installation downgrade, restore the matching private database backup as described in the recovery guide; do not erase a newer working database.

[Acceptance coverage and operational limits](ACCEPTANCE.md) distinguish the standalone workflows from later Bidlark/external provider integration and optional offline synchronization. This release does not claim external security/payroll certification. Docker instructions are supplied; a Docker image build was not executed on this Mac. The Node self-hosted application and hosted read-only release were exercised directly.

[Prior release evidence](RELEASE-0.1.md).
