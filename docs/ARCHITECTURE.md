# Architecture and integration contract

CAS FieldOps is a single-server TypeScript application with a React UI, an Express API and durable SQLite. `Store` creates additive schema version 7 at startup; `revisions` and `attachments` are also created additively for existing installations. The database uses WAL, foreign keys, a busy timeout and `BEGIN IMMEDIATE` for every authenticated mutation. Backups use SQLite's online backup API.

Organizations, users and sessions are relational. Domain records are typed and Zod-validated JSON keyed by `(org, kind, id)`, with project indexes and a unique per-organization PO number. Record revisions retain prior bodies. Immutable inventory movements and audit events have database-level update/delete guards. Quantities are normalized to an explicit unit; inventory comparisons use a 1e-6 tolerance. Only explicitly selected, approved conversions can normalize import units; original rows and factors remain traceable. Preview tokens bind the reviewed source, part version, conversion and existing requirement.

The HTTP layer derives the actor from an HTTP-only session, not a client role/tenant parameter. A POST/PATCH requires a unique `Idempotency-Key` header; retries with the same actor/body/path return the recorded result. Reusing a key with different content fails. Updates require a current record `version`; stale changes fail with 409. Never call domain mutation methods from a new transport without the `Operations.write` transaction wrapper.

## Versioned API

All application routes are under `/api/v1`.

| Route                                   | Operation                                                                 |
| --------------------------------------- | ------------------------------------------------------------------------- |
| GET `/workspace`                        | Authorized snapshot, readiness, forecasts and role-redacted data          |
| POST `/records/:kind`                   | Create a validated domain record                                          |
| PATCH `/records/:kind/:id`              | Revise permitted fields with `version`                                    |
| POST `/records/:kind/:id/transition`    | Workflow action `{status, version, reason?}`                              |
| POST `/purchase-orders/:id/promises`    | Record supplier promises without changing quantity/cost                   |
| POST `/inventory/movements`             | Atomic receive/reserve/release/issue/install/return/transfer/reverse      |
| POST `/assignments/preview`             | Cross-project capacity, availability and certification warnings           |
| PATCH `/assignments/:id`                | Validate and move assignment                                              |
| POST `/assignments/:id/cancel`          | Audited cancellation                                                      |
| POST `/imports/preview`                 | Parse file or validate mapped rows, returning originals and review errors |
| POST `/imports/commit`                  | Revalidate and atomically apply a reviewed source revision                |
| GET `/reports/json?projectId=&section=` | Versioned, role-filtered integration contract                             |
| GET `/reports/xlsx` or `/reports/csv`   | Same project/section filters                                              |
| GET/POST `/attachments`                 | Authorized evidence list/upload                                           |
| GET `/attachments/:id`                  | Tenant- and role-checked attachment download                              |
| GET/POST `/users`                       | Administrator account list/create                                         |
| POST `/settings`                        | Organization approval policy                                              |

Errors have `{error: string}`. Mutations never send vendor emails or transmit payroll files. Enabled in-app dispatch is delivered asynchronously through the outbox. SQL parameters bind every caller-supplied value. Record type and role inputs use explicit allowlists.

## Integration with CAS Gantt and Bidlark later

Exports carry `schemaVersion: 1`, `exportedAt`, project IDs, task IDs, section names, immutable baseline dates, material readiness reasons and labor/production measures. `readiness[].holds` preserves proposed dates separately. Consumers must match stable project/task IDs, confirm mappings, treat this as a snapshot and retain existing approved schedule baselines. Unknown task IDs must be reviewed rather than auto-created or matched by similar names.

A future Bidlark adapter should implement these same domain contracts against Bidlark's tenant identity and shared project/task storage. Do not synchronize two independent production databases by names or silently treat an estimate as a contracted BOM. The standalone app does not connect to Bidlark and makes no changes there.

## Standalone extension routes

- `POST /operations/:name`: project grants, publish, serialized custody, quote-to-PO, shortage RFQs, worker review, timer/start/stop/cancel, effective labor rate, line backorder, event retry and dispatch setting.
- `GET /operations`: role-filtered permissions, grants, event status and restricted rates.
- `POST /planning/range-preview` and `/planning/range`: validated working-day staffing, up to two years; atomic save.
- `POST /planning/scenario`: unsaved calendar/material/dependency/equipment simulation.
- `POST /planning/level-preview`, `/level-apply`, `/level-undo`: reviewed moves with a stale-preview digest and per-record undo version checks.
- `POST /planning/template`: certification-checked explicit crew membership.
- `GET /timeline/:kind/:id`: scoped record revisions; supplier history requires supplier-cost permission.
- `GET /analytics/{view,json,csv,xlsx,pdf}`: project/section/date filters, optional table; payroll additionally requires `payroll=true&consent=confirmed`, explicit permission and valid time/rates/codes.
- `GET /organization/export`: administrator operational data/revisions/audit, excluding credentials and attachment bytes.
- `POST /retention/preview`, `/retention/apply`: administrator preview/digest/typed-confirmation attachment retention.

`records` includes amendments, credits, split shipments, serialized assets, damage proposals, calendars, templates, equipment, schedule revisions, check-ins, cost codes, notices and production corrections. All mutation routes retain the same tenant, transaction, idempotency and version rules. No caller can pass an arbitrary role or tenant.

## Outbox and access

Record creation/update commits an outbox event in the same SQLite transaction. A five-second worker delivers enabled assignment dispatch to linked worker accounts. `(event_id, consumer)` receipts suppress duplicate delivery. Failures back off exponentially and enter dead-letter after five attempts; administrators can retry. The consumer uses event-time assignment data and never invokes an external messaging provider. In-app acknowledgement is a separate audited record transition. This is the integration boundary for future adapters, not an assertion that Bidlark is already connected.

Project grants and payroll grants are relational, separate from roles and from the free standalone module entitlement. Operational balance checks read the whole tenant ledger even when the actor's project snapshot is filtered, preventing double reservation across hidden projects. Published viewer summaries are immutable saved snapshots. Payroll rates use a dedicated relational table and are omitted from general workspace snapshots.

Schedule revisions explicitly choose forecast or approved baseline mode. The prior baseline remains in record revisions, and the original baseline is retained when rebaselining. No readiness or scenario calculation silently moves dates. Quarantine receipts count toward delivery reconciliation but not usable stock; inspection releases accepted quantity. Serialized units cannot be consumed by bulk movements.

Distributed storage, SSO and live Bidlark deployment remain outside this single-server implementation; SSO is not required by the supplied standalone brief.

## Expanded standalone contracts (0.3)

- Materials: `GET /materials/workspace`, `/materials/timeline`, `/materials/compare` provide scoped grid/history and exact quantity/unit/currency quote comparison.
- Intake: `POST /intake/decode`, `/intake/{po,estimate}/preview`, `/intake/{po,estimate}/commit`. Preview tokens bind reviewed source and current records; commits are atomic. External PO source-line IDs persist across revisions. Estimate versions carry source hashes, field/PM budgets and explicit task allocations. The adapter matches the inspected Bidlark `lineItems`, `bomSnapshot`, `lineItemsSnapshot` and revision contracts; per-unit labor hours are multiplied by quantity. Missing units require human mapping.
- Field: minimal assigned packages derived from the authorized `/workspace` snapshot; `POST /operations/fieldEntry`, `/operations/fieldSync`; sync includes assignment/task versions and stable idempotency keys. Conflict review is explicit, and evidence uploads have separate retry receipts.
- People: dated `crewMembership` records and crew/worker calendars intersect. Historical time/production preserve `crewAtEntry`; `GET /workforce` provides scoped headcount, capacity, productivity and bottleneck tables.
- Financials: `GET /financial`, `/financial/export`; `/operations/price` and `/operations/priceApprove` append private price revisions. Rates and their revision history are in separate tables. General organization exports omit both.
- Tenancy: `GET/POST /tenants`, `POST /tenants/members`, `/tenants/switch`, `/tenants/owner`. Session-selected membership supplies the actor; the client cannot choose a role.
- Hosted billing: `GET /billing`, `POST /billing/checkout`, `/billing/portal`; the raw signed webhook is `POST /api/billing/webhook`. Plan entitlement does not bypass role/project/financial permissions. One pending checkout per organization shares a stable provider idempotency key and expires after 31 minutes.
- External events: `GET /adapters`, `POST /operations/adapter`, `/operations/adapterRetry`. Contract version 1 includes stable event/org/entity IDs, event type, timestamp and nonfinancial data. `server/contracts.ts` lists supported types. Readiness and progress changes commit with business records. Each adapter has its own cursor, queue, receipt and five-attempt dead-letter policy. New adapters start with future events.

Supplier routes are explicitly allowlisted. Supplier promises only update acknowledged/confirmed dates; they cannot edit quantity or price. Vendor documents require explicit sharing. Native Gantt reads the same readiness and forecast arrays as the dashboard.

Inventory receipt records preserve PO version IDs, not private prices. Financial report valuation resolves the corresponding private revision. Returns use the running weighted-average received value and reversals undo the original value. Older receipts without a version use the last PO revision timestamp at receipt; same-millisecond legacy edits may require reconciliation. Optional PO-line task allocations drive section delivery/spend reports; unallocated lines remain project-only. Freight/tax have no assumed section split.
