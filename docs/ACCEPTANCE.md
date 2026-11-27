# Release scope and acceptance

Version 0.1 implements the working materials/manpower core and field approvals. The original brief describes a broader multi-milestone product. This release should enter a user-operated pilot before commercial rollout.

## Automated regression coverage

Tests run against fresh in-memory SQLite databases and a real ephemeral HTTP listener. The suite verifies partial receipts; over-receipt rejection; cross-project double reservation; issue/install balances; returns; transfer conservation; reversal dependencies; idempotent receipt retries; tenant isolation; duplicate aliases and unit errors; non-duplicating BOM revisions; immutable baseline dates; unknown ARO dates; cross-project scheduling conflicts; justified overrides; leave, holidays, certification gaps and DST dates; draft versus approved actuals; lock/correction audit; duplicate time; task-scoped 33-unit production; PM/foreman/viewer field privacy; worker identity; separation of duties; stale edits; synthetic demo seeding; HTTP sessions/logout; hostile-origin rejection; filtered JSON/XLSX exports; evidence type and access checks; and public-demo write rejection.

Browser checks cover the local dashboard, receiving, time approval, the weekly resource board and narrow-screen navigation. Release evidence belongs in `docs/RELEASE.md`; do not treat this paragraph as a substitute for recorded results.

## Deliberate limits relative to the product concept

- Core PO draft/submit/approve/issue/acknowledge/cancel works. Issued commercial quantity/cost changes use cancellation plus a replacement PO; there is no full commercial amendment/credit-memo subsystem.
- Receipt photos/PDFs and lot/serial references are supported. Barcode scanning, individual serialized-unit lifecycle and warranty reports remain future work.
- Exact aliases, mappings and explicit units are validated. Automatic dimensional/package conversions and a production Bidlark estimate adapter are not enabled.
- Crew names, individual assignments and overrides work. Shift breaks, region dispatch, notification acknowledgements and automatic resource leveling remain future work.
- Manual time/production and approval are implemented. Clock timer, offline drafts/sync conflicts, payroll exports/integration and GPS are not enabled.
- Capacity scenario arithmetic is separate from saved assignments. It does not forecast GC dependencies, material constraints, automatic overtime premiums or approved completion dates.
- Durable tenant-scoped data and role redaction are implemented. This release has one organization setup per installation, organization-wide PM/foreman roles, no external signup or project-specific grants, and no billing/SSO/retention console.
- Reports support project/section filters, workbook/CSV/JSON export and browser PDF printing. Advanced procurement reliability, warranty, exception aging, and custom reporting remain future work.
- Gantt constraints are exported as proposed holds. Live two-way Gantt/Dashboard/Bidlark synchronization and a retrying transactional event outbox remain future work.

Nothing in the promotion should call these future capabilities implemented or suggest the read-only public demonstration can store a visitor's live job records.
