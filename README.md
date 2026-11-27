# CAS FieldOps

Open-source material and manpower tracking for construction teams. MIT licensed, self-hosted, and independent of Bidlark.

[Product page](https://cas-tx.com/Tracking/) · [Read-only demonstration](https://cas-tx.com/Tracking/app/) · [User guide](docs/USER-GUIDE.md) · [Architecture and API](docs/ARCHITECTURE.md)

## Run it

Requires Node.js 22.13 or newer (Node 22 LTS is tested).

```sh
npm ci
npm run dev
```

Open http://127.0.0.1:4328. Create your organization and administrator account. Optionally load the clearly labeled EPCC demonstration fixture. There are **no default production credentials**. No AI API key or paid service is needed.

```sh
npm test
npm run build
NODE_ENV=production npm start
```

Or run `docker compose up --build -d`; the port is bound to localhost. The named volume persists SQLite records and evidence files. First-run setup must be completed through your private connection before exposing the app through an HTTPS reverse proxy.

## Working workflows

- Projects, sections, task instructions, dependencies, equipment constraints, field/PM budgets, approved production, remaining-hour forecasts and reviewed schedule/baseline revisions.
- Catalog aliases, trade/CSI/UNSPSC classification, accessories, barcode lookup and approved unit conversions. Reviewed CSV/XLSX/JSON imports retain source rows and reject stale reviews, unit errors and duplicates.
- Shortage RFQs, quote price tiers and approval, multi-line POs, supplier promises, issued-order amendments, backorders, split shipments, returns, credit approvals and replacement provenance.
- Receipts, quarantine/inspection, reservations, issue/install, transfers, reversals, approved damage/adjustments and individual serialized custody with warranties. Inventory is an immutable movement ledger.
- Crew templates, worker shifts/breaks, holidays, leave, certifications, priority/allocation/roles, two-year date-range staffing and a weekly resource board. Equipment/dependency/capacity conflicts require a recorded manager justification.
- Manual, bulk and timer-based time; worker review; PM approval; lock/correction workflows; job codes; check-ins and photo/PDF evidence. Only approved time and production change actuals and earned hours.
- Calendar/material-constrained crew scenarios, modeled overtime cost and explicitly applied, reversible leveling suggestions. Scenarios do not reserve workers or change schedules.
- In-app dispatch/acknowledgements backed by a durable event outbox, retries, consumer receipts and dead-letter monitoring.
- Project grants and explicitly published viewer summaries. Supplier cost and payroll permissions are separate. Effective labor rates stay outside general worker records; payroll exports require explicit permission, confirmation and validated coded time.
- Material, spend, reliability, availability, productivity, certification, warranty, exception and closeout reports in XLSX, CSV, JSON and server-generated PDF. Organization data export and previewed attachment retention.
- HTTP-only sessions, hashed passwords, origin checks, login throttling, tenant isolation, optional separation of duties, idempotent transactions, optimistic versions, audit and recovery.

## Standalone scope

Version **0.2** implements the standalone workflows in the tracking brief. See [acceptance and operational limits](docs/ACCEPTANCE.md) and [release evidence](docs/RELEASE.md).

This edition is an MIT-licensed, single-server application. All modules are included; it has no subscription billing, SSO or public multi-tenant signup. A later Bidlark adapter will supply its own tenant identity and commercial entitlements. Live Bidlark/Gantt synchronization, external email/SMS delivery and optional offline synchronization are outside this standalone release. No GPS, automatic payroll transmission, tax calculation or supplier-email automation is enabled.

Scanning accepts exact barcode/QR values from keyboard-compatible scanners or pasted codes. PDF/CSV/XLSX reports are downloadable; payroll gross is a rate-based export, not a payroll processor. Readiness still requires accepted, allocated stock. Scenario dates are conditional on recorded constraints and do not guarantee future crew availability.

Each installation starts with one organization. Storage and authorization remain tenant-scoped. SQLite targets a small-team single-server deployment; multiple replicas require a different deployment/database design.

The public demo is read-only and contains synthetic records. Install your own copy for writable use.

## Upgrade from 0.1

Back up the database before updating. Migration 2 adds project grants, isolated rates and the event outbox without rewriting operational history. **Non-admin accounts need explicit project grants after upgrade** (worker accounts also inherit access from their assignments). Use Operations center → Access & data. Viewer accounts see nothing until a manager/admin publishes a project summary. Payroll remains disabled until an administrator explicitly grants it, including to themselves. Existing quote records can enter the new approval workflow.

## Configuration and recovery

| Variable         | Default                | Purpose                                                                                  |
| ---------------- | ---------------------- | ---------------------------------------------------------------------------------------- |
| `PORT`           | `4328`                 | HTTP listener                                                                            |
| `HOST`           | `127.0.0.1`            | Network interface                                                                        |
| `DATABASE_PATH`  | `data/fieldops.sqlite` | Durable database, including evidence blobs                                               |
| `APP_ORIGIN`     | Request origin         | Exact HTTPS origin behind a reverse proxy                                                |
| `COOKIE_SECURE`  | false                  | Set `true` for HTTPS deployments                                                         |
| `BASE_PATH`      | `/`                    | Optional path prefix, supplied at build and runtime; proxy must strip it                 |
| `DEMO_READ_ONLY` | false                  | Seeds an empty installation with demo data, disables all HTTP writes, no shared password |

Run `npm run backup` for a consistent SQLite backup including users, records, attachments, audit and revisions. Copy backups to encrypted off-server storage. To restore, stop the service, retain the current database as a rollback copy, move aside its `-wal` and `-shm` sidecars, restore a backup to `DATABASE_PATH`, and restart. Never run a demo seed or restore over real records. Test your own backup/restore process before using this for live operations.

## Development

TypeScript throughout; React/Vite UI; Express API; Node SQLite. Automatic additive migration runs on startup. Database access and mutations are isolated in `server/store.ts`; domain rules live in `server/domain.ts`. All required fonts ship locally through licensed npm packages. No external analytics or AI service is used.

Contributions are welcome through GitHub issues and pull requests. Include a regression test for changes to stock, time, approval, or tenant boundaries. Do not include production data, credentials, real employee records, or customer attachments.

Copyright 2026 CAS-TX. Released under the [MIT license](LICENSE). Dependencies retain their own licenses.
