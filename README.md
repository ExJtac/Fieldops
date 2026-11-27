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

- Projects, sections, tasks, immutable baseline dates, quoted field/PM budgets, proposed schedule holds and scope changes.
- Part catalog with exact aliases; reviewed CSV/XLSX/JSON BOM imports, column mapping, unit and duplicate validation, and revisions that replace quantities without double counting.
- Suppliers, recorded RFQs, supplier quotes, landed totals, approval-controlled multi-line purchase orders, cancellation of unreceived balances, and separately recorded confirmed versus forecast ETAs.
- Partial receipts, reservations, release, issue, installation, returns, warehouse transfers and admin reversals. An append-only ledger prevents over-receipt and double allocation.
- Workers, crews, skills and expiry, calendars, holidays and leave. Weekly resource board with drag-to-move, cross-project conflict checking, and justified manager overrides.
- Manual and bulk crew time entries, submission, approval/rejection, locking and correction requests. Only approved/locked time and pending corrections to approved time count toward actuals.
- Submitted/approved daily production, earned hours, task-specific completion and approved remaining-labor forecasts. Separate crew-capacity scenario calculator.
- Role-filtered reports in XLSX, CSV and versioned integration JSON; print-to-PDF reports/POs; PDF and image evidence on inventory transactions, POs and time entries.
- Password hashing, HTTP-only sessions, origin protection, login throttling, tenant-scoped records, role redaction, opt-in segregation of duties, idempotent writes, optimistic version checks, audit and revision history.

## First release boundaries

This is a working **0.1 pilot release**, not completion of every advanced requirement in the original product concept. See [scope and acceptance](docs/ACCEPTANCE.md) for exact coverage.

No subscription billing, payroll integration, GPS tracking, automatic vendor email, live Bidlark integration, notification delivery, offline synchronization, barcode scanning, automatic resource leveling, or public customer signup is enabled. Supplier documents and cost are restricted to administrators/purchasing. The PM/foreman roles are organization-wide; project-by-project membership restrictions are not yet implemented. This version keeps payroll and customer sell-price data out of the application entirely.

A self-hosted installation uses one initial organization. Storage and authorization are tenant-scoped for future integration; there is no multi-tenant SaaS onboarding UI. SQLite is intended for a small-team single-server deployment. Multiple application replicas and high-volume commercial SaaS need an additional deployment and concurrency review.

The public demo is read-only with fictionalized/sample records and cannot accept customer or employee information. Writable use is available on your own installation.

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
