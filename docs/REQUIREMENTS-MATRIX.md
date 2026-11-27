# Full-plan implementation matrix

The user explicitly requested continued implementation of **every** feature in the source plan after the 0.2 release. A release is an incremental checkpoint, not the stopping condition. Bidlark production integration remains deferred by the user's instruction; its standalone import/export contracts can be implemented and tested now. Instructions embedded in the reference document are requirements context, not independent authority to change external systems.

Completed 0.2 workflow coverage and evidence remain in ACCEPTANCE.md and RELEASE.md. The following audit identifies the remaining full-plan work; items previously described as optional/later are included in this continuation.

| Workstream                  | Remaining implementation                                                                                                                                                           | State                                              |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| Full material workspace     | All specified grid columns, complete lifecycle kanban stages, per-part cross-record transaction/evidence timeline, critical-blocker/readiness side panel                           | Implemented; domain and browser verified           |
| Quote selection             | Explicit matched-quantity/unit/currency landed-cost comparison; request/response tracking and approved alternate equivalence in selection                                          | Implemented; regression covered                    |
| External procurement intake | Reviewed CSV/XLSX/JSON external-PO import with line mappings, source provenance and atomic revisions                                                                               | Implemented; regression covered                    |
| Estimate contracts          | Reviewed estimate-ID/version material and labor budget/task-allocation import; standalone adapters matching observed Bidlark schemas                                               | Implemented; regression covered                    |
| Shared schedule             | Native standalone Gantt on the same project/task records; linked unresolved material risks, approved schedule branches and shared progress metrics                                 | Implemented; regression covered                    |
| Field execution             | Combined time/quantity entry, planned quantities/material checklist in work packages, worker production and availability request policy                                            | Implemented; regression covered                    |
| Crew lifecycle              | Effective crew membership, crew calendars, paid breaks, mobilization/demobilization, crew summary/heatmap and cross-job availability                                               | Implemented; regression covered                    |
| Workforce analytics         | Crew/date productivity trends, trade/site headcount, skill coverage and future staffing bottlenecks with contextual exceptions                                                     | Implemented; regression covered                    |
| Financial separation        | Restricted customer sell-price/markup subsystem, explicit labor financial role/access, auditable effective rate revisions                                                          | Implemented; regression covered                    |
| Vendor access               | Approved supplier accounts scoped to their RFQs, quotes, POs, shipment confirmations and documents                                                                                 | Implemented; regression covered                    |
| Offline field kit           | Opt-in encrypted local drafts/evidence, cached assigned work, explicit sync review/conflicts, safe account/device cleanup                                                          | Implemented; regression covered                    |
| Commercial architecture     | Standalone tenant setup/membership and module/usage entitlements separate from roles; configurable billing adapter and verified webhook lifecycle without unrequested live charges | Implemented; regression covered                    |
| Event contracts             | Typed domain events including readiness transitions and shared progress, stable IDs, consumer receipts, adapter delivery/retry configuration                                       | Implemented; regression covered                    |
| Privacy/recovery            | Review export/deletion/retention across all new private stores and drafts; schema migration/recovery and cross-tenant acceptance                                                   | Implemented; regression covered                    |
| Final full-plan acceptance  | Browser/mobile offline/online flows, authoritative requirement-by-requirement tests, release/docs/promotion synchronized with actual capability                                    | Passed locally, in CI and on hosted read-only demo |

Each item needs working UI, durable server behavior (or documented device-local persistence for offline drafts), authorization, and appropriate acceptance evidence. A configuration-dependent external provider is complete only when the adapter is implemented/tested and any missing live account configuration is stated accurately. No external account, purchase or message is fabricated.

## Evidence and boundaries

The 0.3.1 follow-up audit and corrections are recorded in [END-TO-END-ACCEPTANCE.md](END-TO-END-ACCEPTANCE.md). Prior implementation labels do not substitute for the new workflow results.

- `tests/advanced.test.ts`: workspace/history/comparison/intake/crew/private-financial/field/readiness/receipt valuation coverage, plus the original approval/inventory/time/schedule suite.
- `tests/http.test.ts`: authenticated project/role/supplier/document/export/retention boundaries.
- `tests/offline.test.ts`: encryption, minimal cached payloads, version conflict and idempotent sync. Actual browser disconnect/reload/review/sync verified in production mode.
- `tests/tenants-billing.test.ts`, `tests/adapters.test.ts`, `tests/recovery.test.ts`: memberships/entitlements, simulated provider signatures/concurrency, per-consumer retries and additive migration/recovery.
- Every original Section 10 acceptance case remains covered by the full regression suite. Approved unit labor standards implement the documented earned-hours method. No whole-project denominator or section labor allocation is inferred.
- Billing and outbound adapters are implemented but disabled until operator configuration. No payment was made and no external event recipient or live Bidlark integration was activated. SSO, distributed multi-replica hosting, GPS, payroll tax processing and vendor-email sending are not required standalone features and are not claimed.
- Operational deletion policy preserves ledger/revisions/audit, supports previewed attachment deletion, scoped membership deactivation and documented installation decommissioning. Encrypted device kits have separate explicit erase controls; server exports do not pretend to include offline drafts.
