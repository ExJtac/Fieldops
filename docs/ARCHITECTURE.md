# Architecture and integration contract

CAS FieldOps is a single-server TypeScript application with a React UI, an Express API and durable SQLite. `Store` creates additive schema version 1 at startup; `revisions` and `attachments` are also created additively for existing installations. The database uses WAL, foreign keys, a busy timeout and `BEGIN IMMEDIATE` for every authenticated mutation. Backups use SQLite's online backup API.

Organizations, users and sessions are relational. Domain records are typed and Zod-validated JSON keyed by `(org, kind, id)`, with project indexes and a unique per-organization PO number. Record revisions retain prior bodies. Immutable inventory movements and audit events have database-level update/delete guards. Quantities are normalized to an explicit unit; inventory comparisons use a 1e-6 tolerance. This release rejects unit mismatches rather than guessing conversions.

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

Errors have `{error: string}`. Mutations never send vendor emails, payroll files or staff messages. SQL parameters bind every caller-supplied value. Record type and role inputs use explicit allowlists.

## Integration with CAS Gantt and Bidlark later

Exports carry `schemaVersion: 1`, `exportedAt`, project IDs, task IDs, section names, immutable baseline dates, material readiness reasons and labor/production measures. `readiness[].holds` preserves proposed dates separately. Consumers must match stable project/task IDs, confirm mappings, treat this as a snapshot and retain existing approved schedule baselines. Unknown task IDs must be reviewed rather than auto-created or matched by similar names.

A future Bidlark adapter should implement these same domain contracts against Bidlark's tenant identity and shared project/task storage. Do not synchronize two independent production databases by names or silently treat an estimate as a contracted BOM. The standalone app does not connect to Bidlark and makes no changes there.

A transactional outbox, per-project grants, distributed database adapter, SSO, billing, notification delivery and long-running imports are intentionally not wired in this release. Audit is not a notification outbox. Do not claim event delivery from the presence of an audit record.
