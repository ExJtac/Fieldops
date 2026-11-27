import React, { useEffect, useState, type ReactNode } from "react";
type R = Record<string, any>;
const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
const day = () =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "America/Denver" }).format(
    new Date(),
  );
const fmt = (v: any) =>
  v == null
    ? "—"
    : typeof v === "number"
      ? v.toLocaleString(undefined, { maximumFractionDigits: 2 })
      : String(v);
export function Workflows({
  ws,
  project,
  open,
  showEvidence,
  action,
  api,
  refresh,
}: {
  ws: R;
  project: string;
  open: (kind: string, defaults?: R, record?: R) => void;
  showEvidence: (kind: string, r: R) => void;
  action: (fn: () => Promise<any>, message?: string) => void;
  api: (path: string, body?: any, method?: string) => Promise<any>;
  refresh: () => Promise<any>;
}) {
  const role = ws.actor.role,
    admin = role === "admin",
    manager = ["admin", "pm"].includes(role),
    buyer = ["admin", "purchasing"].includes(role),
    editable = !ws.readOnly;
  const [tab, setTab] = useState(role === "worker" ? "field" : "procurement"),
    [meta, setMeta] = useState<R>({}),
    [users, setUsers] = useState<R[]>([]),
    [error, setError] = useState(""),
    [history, setHistory] = useState<R | null>(null),
    [scan, setScan] = useState("");
  const rows = (kind: string): R[] =>
      (ws.data[kind] || []).filter(
        (r: R) => !project || !r.projectId || r.projectId === project,
      ),
    label = (kind: string, id: string) => {
      const r = (ws.data[kind] || []).find((r: R) => r.id === id);
      return r?.name || r?.partNumber || r?.number || r?.code || id || "—";
    };
  useEffect(() => {
    api("/api/v1/operations")
      .then(setMeta)
      .catch((e) => setError(e.message));
    if (admin && !ws.readOnly)
      api("/api/v1/users")
        .then(setUsers)
        .catch((e) => setError(e.message));
  }, [ws]);
  const call = (name: string, body: R, message = "Saved") =>
    action(() => api("/api/v1/operations/" + name, body), message);
  const transition = (kind: string, r: R, status: string, extra: R = {}) =>
    action(() =>
      api(`/api/v1/records/${kind}/${r.id}/transition`, {
        status,
        version: r.version,
        ...extra,
      }),
    );
  const button = (title: string, kind: string, defaults: R = {}, record?: R) =>
    editable ? (
      <button
        onClick={() =>
          open(
            kind,
            {
              projectId: project || rows("project")[0]?.id,
              date: day(),
              ...defaults,
            },
            record,
          )
        }
      >
        {title}
      </button>
    ) : null;
  const table = (headers: string[], items: R[], render: (r: R) => ReactNode) =>
    items.length ? (
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              {headers.map((h) => (
                <th key={h}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {items.map((r, i) => (
              <tr key={r.id || i}>{render(r)}</tr>
            ))}
          </tbody>
        </table>
      </div>
    ) : (
      <p className="empty-note">
        No records yet. Add the first record to start this workflow.
      </p>
    );
  const proposals = (
    kind: string,
    title: string,
    canCreate: boolean,
    detail: (r: R) => ReactNode,
    canApprove = manager,
  ) => (
    <section className="panel">
      <div className="panel-head">
        <h2>{title}</h2>
        {canCreate && button("Add " + title.toLowerCase(), kind)}
      </div>
      {table(["Record", "Status", "Review"], rows(kind), (r) => (
        <>
          <td>
            {detail(r)}
            <small>{r.reason}</small>
          </td>
          <td>{r.status}</td>
          <td>
            {editable && canApprove && r.status === "Proposed" && (
              <div className="actions">
                <button onClick={() => transition(kind, r, "Approved")}>
                  Approve
                </button>
                <button onClick={() => transition(kind, r, "Rejected")}>
                  Reject
                </button>
              </div>
            )}
          </td>
        </>
      ))}
    </section>
  );
  const timeline = (kind: string, id: string) =>
    void api(`/api/v1/timeline/${kind}/${id}`)
      .then(setHistory)
      .catch((e) => setError(e.message));
  return (
    <div className="workflow-center">
      <div className="page-heading">
        <div>
          <span className="eyebrow">STANDALONE OPERATIONS</span>
          <h1>From purchase to closeout.</h1>
          <p>Review changes, manage field work, and keep a traceable record.</p>
        </div>
      </div>
      <div className="workflow-tabs">
        {(role === "worker"
          ? ["field"]
          : [
              "procurement",
              "equipment",
              "planning",
              "field",
              "reports",
              ...(admin || meta.payroll ? ["access"] : []),
            ]
        ).map((t) => (
          <button
            key={t}
            className={tab === t ? "primary" : ""}
            onClick={() => {
              setTab(t);
              setHistory(null);
            }}
          >
            {
              (
                {
                  procurement: "Purchases",
                  equipment: "Inventory & assets",
                  planning: "Crew & schedule",
                  field: "Field work",
                  reports: "Detailed reports",
                  access: "Access & data",
                } as R
              )[t]
            }
          </button>
        ))}
      </div>
      {error && (
        <p role="alert" className="message error">
          {error}
          <button onClick={() => setError("")}>Dismiss</button>
        </p>
      )}
      {tab === "procurement" && (
        <>
          <section className="panel">
            <div className="panel-head">
              <div>
                <h2>Quotes & shortage requests</h2>
                <p>
                  Compare matching quantities and currencies. Approval selects a
                  quote; creating a PO starts its own approval workflow.
                </p>
              </div>
              <div className="actions">
                {buyer && button("Shortage RFQs", "op:shortageRfqs")}
                {buyer && button("Add quote", "quote")}
              </div>
            </div>
            {table(
              [
                "Supplier / part",
                "Quantity / price",
                "Lead / validity",
                "Status",
                "Actions",
              ],
              rows("quote"),
              (r) => (
                <>
                  <td>
                    {label("supplier", r.supplierId)}
                    <small>{label("part", r.partId)}</small>
                  </td>
                  <td>
                    {r.quantity} {r.unit}
                    <small>
                      {fmt(r.unitCost)} {r.currency} each · freight{" "}
                      {fmt(r.freight)} · tax {fmt(r.tax)}
                    </small>
                    {(r.tiers || []).map((t: R) => (
                      <small key={t.minimum}>
                        {t.minimum}+ → {t.unitCost}
                      </small>
                    ))}
                  </td>
                  <td>
                    {r.leadMin}–{r.leadMax} days ARO
                    <small>{r.ackDate || "Acknowledgement unconfirmed"}</small>
                    <small>Valid through {r.validUntil || "unspecified"}</small>
                  </td>
                  <td>{r.status || "Quoted"}</td>
                  <td>
                    <div className="actions">
                      {editable &&
                        admin &&
                        (r.status || "Quoted") === "Quoted" && (
                          <button
                            onClick={() => transition("quote", r, "Approved")}
                          >
                            Approve quote
                          </button>
                        )}
                      {buyer &&
                        r.status === "Approved" &&
                        button("Create PO", "op:quoteToPo", {
                          id: r.id,
                          quantity: r.quantity,
                        })}
                      {buyer && (
                        <button onClick={() => timeline("quote", r.id)}>
                          History
                        </button>
                      )}
                    </div>
                  </td>
                </>
              ),
            )}
          </section>
          <section className="panel">
            <div className="panel-head">
              <h2>Issued purchase orders</h2>
            </div>
            {table(
              ["PO", "Source", "Lines / backorders", "Actions"],
              rows("po").filter((r) =>
                ["Issued", "Acknowledged"].includes(r.status),
              ),
              (r) => (
                <>
                  <td>
                    {r.number}
                    <small>
                      {r.status} · revision {r.version}
                    </small>
                  </td>
                  <td>
                    {r.externalReference || r.source || "FieldOps"}
                    {r.replacesPoId && (
                      <small>Replaces {label("po", r.replacesPoId)}</small>
                    )}
                  </td>
                  <td>
                    {r.lines.map((l: R) => (
                      <small key={l.id}>
                        {label("part", l.partId)} · {l.quantity} ordered ·{" "}
                        {l.backordered || 0} backordered
                      </small>
                    ))}
                  </td>
                  <td>
                    <div className="actions">
                      {buyer &&
                        button("Propose amendment", "poAmendment", {
                          projectId: r.projectId,
                          poId: r.id,
                          poVersion: r.version,
                          freight: r.freight,
                          tax: r.tax,
                          lines: r.lines,
                        })}
                      {buyer &&
                        button("Backorder", "op:backorder", {
                          id: r.id,
                          poId: r.id,
                          version: r.version,
                        })}
                      {buyer &&
                        button("Split shipment", "shipment", {
                          poId: r.id,
                          projectId: r.projectId,
                        })}
                      {buyer &&
                        button("Replacement PO", "po", {
                          projectId: r.projectId,
                          supplierId: r.supplierId,
                          replacesPoId: r.id,
                          source: "Replacement for " + r.number,
                        })}
                    </div>
                  </td>
                </>
              ),
            )}
          </section>
          {proposals(
            "poAmendment",
            "PO amendments",
            false,
            (r) => (
              <>
                {label("po", r.poId)} · {r.lines.length} lines · freight{" "}
                {r.freight} / tax {r.tax}
              </>
            ),
            admin,
          )}
          <section className="panel">
            <div className="panel-head">
              <h2>Split shipments</h2>
              {buyer && button("Add shipment", "shipment")}
            </div>
            {table(
              ["Shipment", "PO / lines", "Arrival", "Status", "Actions"],
              rows("shipment"),
              (r) => (
                <>
                  <td>
                    {r.reference}
                    <small>
                      {r.carrier} · {r.tracking}
                    </small>
                  </td>
                  <td>
                    {label("po", r.poId)}
                    {r.lines.map((l: R) => (
                      <small key={l.lineId}>{l.quantity} units</small>
                    ))}
                  </td>
                  <td>
                    {r.expectedDate || "Unconfirmed"}
                    <small>{r.actualDate || ""}</small>
                  </td>
                  <td>{r.status}</td>
                  <td>
                    {editable && buyer && r.status === "Planned" && (
                      <button
                        onClick={() => transition("shipment", r, "Shipped")}
                      >
                        Mark shipped
                      </button>
                    )}
                    {editable && buyer && r.status === "Shipped" && (
                      <button
                        onClick={() => {
                          const date = window.prompt(
                            "Actual delivery date (YYYY-MM-DD)",
                            day(),
                          );
                          if (date)
                            transition("shipment", r, "Delivered", {
                              actualDate: date,
                            });
                        }}
                      >
                        Mark delivered
                      </button>
                    )}
                    {editable &&
                      buyer &&
                      ["Planned", "Shipped"].includes(r.status) && (
                        <button
                          onClick={() => transition("shipment", r, "Cancelled")}
                        >
                          Cancel shipment
                        </button>
                      )}
                    {buyer &&
                      r.status !== "Cancelled" &&
                      button("Receive accepted stock", "movement", {
                        action: "receive",
                        projectId: r.projectId,
                        poId: r.poId,
                        shipmentId: r.id,
                      })}
                  </td>
                </>
              ),
            )}
          </section>
          {proposals(
            "credit",
            "Return credits",
            buyer,
            (r) => (
              <>
                {label("po", r.poId)} · {fmt(r.amount)} {r.currency} ·{" "}
                {r.reference}
              </>
            ),
            admin,
          )}
          {proposals(
            "conversion",
            "Unit conversions",
            buyer,
            (r) => (
              <>
                {label("part", r.partId)} · 1 {r.fromUnit} = {r.factor}{" "}
                {r.toUnit}
              </>
            ),
            admin,
          )}
        </>
      )}
      {tab === "equipment" && (
        <>
          <section className="panel">
            <div className="panel-head">
              <div>
                <h2>Find by barcode, QR value or serial</h2>
                <p>
                  Use a USB/Bluetooth scanner or paste the exact code. Matching
                  never changes stock.
                </p>
              </div>
            </div>
            <input
              aria-label="Scan barcode or serial"
              placeholder="Scan code or enter exact value"
              value={scan}
              onChange={(e) => setScan(e.target.value)}
            />
            {scan && (
              <div className="scan-results">
                {rows("part")
                  .filter((p) =>
                    [p.barcode, p.partNumber, ...p.aliases].includes(scan),
                  )
                  .map((p) => (
                    <p key={p.id}>
                      {p.partNumber} · {p.description} · {p.unit}
                      {buyer &&
                        button("Receive", "movement", {
                          partId: p.id,
                          action: "receive",
                        })}
                    </p>
                  ))}
                {rows("asset")
                  .filter((a) => a.serial === scan)
                  .map((a) => (
                    <p key={a.id}>
                      {a.serial} · {a.status} ·{" "}
                      {label("location", a.locationId)}
                    </p>
                  ))}
              </div>
            )}
          </section>
          <section className="panel">
            <div className="panel-head">
              <div>
                <h2>Serialized custody & warranty</h2>
                <p>
                  Register each accepted unit, then reserve, issue and install
                  it by serial number.
                </p>
              </div>
              {["admin", "purchasing", "foreman"].includes(role) &&
                button("Register serial", "asset")}
            </div>
            {table(
              ["Serial / part", "Custody", "Warranty", "Actions"],
              rows("asset"),
              (r) => (
                <>
                  <td>
                    {r.serial}
                    <small>{label("part", r.partId)}</small>
                  </td>
                  <td>
                    {r.status} · {r.condition}
                    <small>
                      {label("location", r.locationId)} ·{" "}
                      {label("task", r.taskId)}
                    </small>
                  </td>
                  <td>{r.warrantyUntil || "Unspecified"}</td>
                  <td>
                    <div className="actions">
                      {!["Returned", "Installed", "Damaged"].includes(
                        r.status,
                      ) &&
                        button("Move unit", "op:assetMove", {
                          id: r.id,
                          version: r.version,
                          projectId: r.projectId,
                          taskId: r.taskId,
                        })}
                      {!["Returned", "Damaged"].includes(r.status) &&
                        button("Report damage", "adjustment", {
                          assetId: r.id,
                          projectId: r.projectId,
                          partId: r.partId,
                          locationId: r.locationId,
                          action: "damage",
                          quantity: -1,
                        })}
                      <button onClick={() => timeline("asset", r.id)}>
                        Custody history
                      </button>
                    </div>
                  </td>
                </>
              ),
            )}
          </section>
          {proposals(
            "adjustment",
            "Stock adjustments",
            ["admin", "purchasing", "foreman"].includes(role),
            (r) => (
              <>
                {label("part", r.partId)} · {r.quantity} · {r.action} ·{" "}
                {label("location", r.locationId)}
              </>
            ),
            admin,
          )}
          <section className="panel">
            <div className="panel-head">
              <h2>Material movement timeline</h2>
            </div>
            {table(
              ["Date", "Part / action", "Quantity", "Evidence"],
              rows("movement").slice().reverse(),
              (r) => (
                <>
                  <td>{new Date(r.createdAt).toLocaleString()}</td>
                  <td>
                    {label("part", r.partId)}
                    <small>
                      {r.action} · {label("location", r.locationId)}
                    </small>
                  </td>
                  <td>{r.quantity}</td>
                  <td>
                    {r.note}
                    <small>
                      {r.shipmentId
                        ? "Shipment " + label("shipment", r.shipmentId)
                        : ""}
                    </small>
                    <button onClick={() => timeline("movement", r.id)}>
                      History
                    </button>
                  </td>
                </>
              ),
            )}
          </section>
        </>
      )}
      {tab === "planning" && (
        <>
          <section className="panel">
            <div className="panel-head">
              <h2>Calendars & crew templates</h2>
              <div className="actions">
                {manager && button("Worker calendar", "calendar")}
                {manager && button("Crew template", "crewTemplate")}
                {manager && button("Assign date range", "plan:range")}
              </div>
            </div>
            {table(
              ["Worker", "Working days", "Shift / break", "Policy", ""],
              rows("calendar"),
              (r) => (
                <>
                  <td>{label("worker", r.workerId)}</td>
                  <td>
                    {r.workdays
                      .map(
                        (n: number) =>
                          ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][n],
                      )
                      .join(", ")}
                  </td>
                  <td>
                    {r.shiftStart}:00 · {r.shiftHours}h window · {r.unpaidBreak}
                    h break
                  </td>
                  <td>
                    {r.weeklyLimit}h/week · overtime{" "}
                    {r.overtimeAllowed ? "allowed" : "requires approval"}
                  </td>
                  <td>
                    {manager && button("Edit calendar", "calendar", {}, r)}
                  </td>
                </>
              ),
            )}
            {table(
              ["Template", "Trade / roles", "Size", ""],
              rows("crewTemplate"),
              (r) => (
                <>
                  <td>{r.name}</td>
                  <td>
                    {r.trade}
                    <small>
                      {r.roles
                        .map(
                          (x: R) =>
                            `${x.count} ${x.role}${x.skill ? " · " + x.skill : ""}`,
                        )
                        .join("; ")}
                    </small>
                  </td>
                  <td>{r.size}</td>
                  <td>
                    {manager &&
                      button("Build crew", "plan:template", { id: r.id })}
                  </td>
                </>
              ),
            )}
          </section>
          <section className="panel">
            <div className="panel-head">
              <h2>Equipment constraints</h2>
              {manager && button("Add equipment", "equipment")}
            </div>
            {table(
              ["Equipment", "Available from", "Through", ""],
              rows("equipment"),
              (r) => (
                <>
                  <td>{r.name}</td>
                  <td>{r.availableFrom || "Unconfirmed"}</td>
                  <td>{r.availableUntil || "Open"}</td>
                  <td>{manager && button("Edit", "equipment", {}, r)}</td>
                </>
              ),
            )}
          </section>
          {manager && (
            <PlanningTools {...{ ws, project, api, action, refresh }} />
          )}
          {proposals("scheduleRevision", "Schedule revisions", manager, (r) => (
            <>
              {r.name} · {r.dates.length} tasks
              <small>
                {r.dates
                  .map(
                    (d: R) =>
                      `${label("task", d.taskId)}: ${d.start} → ${d.finish}`,
                  )
                  .join("; ")}
              </small>
            </>
          ))}
          <section className="panel">
            <div className="panel-head">
              <h2>Baseline & approved forecast</h2>
            </div>
            {table(
              ["Task", "Baseline", "Forecast", "Instructions"],
              rows("task"),
              (r) => (
                <>
                  <td>
                    {r.name}
                    <small>Priority {r.priority || 3}</small>
                  </td>
                  <td>
                    {r.baselineStart || "—"} → {r.baselineEnd || "—"}
                  </td>
                  <td>
                    {r.forecastStart || "—"} → {r.forecastEnd || "—"}
                  </td>
                  <td>
                    {r.instructions}
                    <small>{r.permits}</small>
                    <small>
                      {(r.dependencies || [])
                        .map((id: string) => label("task", id))
                        .join("; ")}
                    </small>
                  </td>
                </>
              ),
            )}
          </section>
        </>
      )}
      {tab === "field" && (
        <>
          <section className="panel">
            <div className="panel-head">
              <div>
                <h2>Today in the field</h2>
                <p>
                  Timers create a draft timecard. Review the hours before
                  submitting them.
                </p>
              </div>
              <div className="actions">
                {["admin", "pm", "foreman", "worker"].includes(role) &&
                  button("Start timer", "op:timer", {
                    action: "start",
                    workerId: ws.actor.workerId,
                  })}
                {["admin", "pm", "foreman", "worker"].includes(role) &&
                  button("Daily check-in", "checkin", {
                    workerId: ws.actor.workerId,
                  })}
              </div>
            </div>
            {table(
              ["Worker", "Task", "Started", "Actions"],
              rows("timer").filter((r) => r.status === "Running"),
              (r) => (
                <>
                  <td>{label("worker", r.workerId)}</td>
                  <td>{label("task", r.taskId)}</td>
                  <td>{new Date(r.startedAt).toLocaleString()}</td>
                  <td>
                    {editable && (
                      <div className="actions">
                        <button
                          onClick={() =>
                            call("timer", {
                              workerId: r.workerId,
                              action: "stop",
                            })
                          }
                        >
                          Stop & draft time
                        </button>
                        <button
                          onClick={() => {
                            const reason = window.prompt(
                              "Reason for cancelling timer",
                            );
                            if (reason)
                              call("cancelTimer", {
                                id: r.id,
                                version: r.version,
                                reason,
                              });
                          }}
                        >
                          Cancel
                        </button>
                      </div>
                    )}
                  </td>
                </>
              ),
            )}
          </section>
          <section className="panel">
            <div className="panel-head">
              <h2>My work packages</h2>
            </div>
            {table(
              [
                "Date",
                "Worker / task",
                "Instructions",
                "Permits / dependencies",
              ],
              rows("assignment")
                .filter((r) => r.status !== "Cancelled")
                .slice()
                .sort((a, b) => a.date.localeCompare(b.date)),
              (r) => {
                const task = rows("task").find((t) => t.id === r.taskId);
                return (
                  <>
                    <td>
                      {r.date}
                      <small>
                        {r.start}:00 · {r.hours}h
                      </small>
                    </td>
                    <td>
                      {label("worker", r.workerId)}
                      <small>{task?.name}</small>
                      <small>
                        {r.role || ""} · {r.allocation || 100}%
                      </small>
                    </td>
                    <td>{task?.instructions || "No instructions recorded"}</td>
                    <td>
                      {task?.permits || "—"}
                      <small>
                        {(task?.dependencies || [])
                          .map((id: string) => label("task", id))
                          .join("; ")}
                      </small>
                    </td>
                  </>
                );
              },
            )}
          </section>
          <section className="panel">
            <div className="panel-head">
              <h2>Worker time review</h2>
            </div>
            {table(
              ["Date", "Worker / task", "Hours", "Review"],
              rows("time").filter((r) =>
                ["Draft", "Submitted"].includes(r.status),
              ),
              (r) => (
                <>
                  <td>{r.date}</td>
                  <td>
                    {label("worker", r.workerId)}
                    <small>{label("task", r.taskId)}</small>
                  </td>
                  <td>{fmt(r.regular + r.overtime)}</td>
                  <td>
                    {r.workerReviewed
                      ? "Worker reviewed"
                      : "Awaiting worker review"}
                    <button onClick={() => showEvidence("time", r)}>
                      Time evidence
                    </button>
                    {editable &&
                      ws.actor.workerId === r.workerId &&
                      !r.workerReviewed && (
                        <button
                          onClick={() =>
                            call("workerReview", {
                              id: r.id,
                              version: r.version,
                            })
                          }
                        >
                          I reviewed these hours
                        </button>
                      )}
                  </td>
                </>
              ),
            )}
          </section>
          <section className="panel">
            <div className="panel-head">
              <h2>Dispatch inbox</h2>
            </div>
            {table(
              ["Notice", "Received", "Status", ""],
              rows("notice").filter((n) => n.recipientId === ws.actor.id),
              (r) => (
                <>
                  <td>
                    {r.title}
                    <small>{r.message}</small>
                  </td>
                  <td>{new Date(r.createdAt).toLocaleString()}</td>
                  <td>{r.status}</td>
                  <td>
                    {editable && r.status !== "Acknowledged" && (
                      <button
                        onClick={() => transition("notice", r, "Acknowledged")}
                      >
                        Acknowledge
                      </button>
                    )}
                  </td>
                </>
              ),
            )}
          </section>
          {manager && (
            <section className="panel">
              <div className="panel-head">
                <h2>Job cost codes</h2>
                {button("Add cost code", "costCode")}
              </div>
              {table(
                ["Code", "Description", "Budget"],
                rows("costCode"),
                (r) => (
                  <>
                    <td>{r.code}</td>
                    <td>{r.description}</td>
                    <td>{r.laborType}</td>
                  </>
                ),
              )}
            </section>
          )}
          {role !== "worker" &&
            proposals(
              "productionCorrection",
              "Production corrections",
              ["admin", "pm", "foreman"].includes(role),
              (r) => <>Corrected quantity: {r.quantity}</>,
            )}
        </>
      )}
      {tab === "reports" && <ReportTools {...{ ws, project, api }} />}
      {tab === "access" && (
        <>
          {admin && (
            <section className="panel">
              <div className="panel-head">
                <div>
                  <h2>Project grants & published summaries</h2>
                  <p>
                    Non-admin accounts need project access. Viewers see only the
                    latest summary you explicitly publish.
                  </p>
                </div>
              </div>
              {table(["Account", "Role", "Projects", "Actions"], users, (r) => (
                <>
                  <td>
                    {r.name}
                    <small>{r.email}</small>
                  </td>
                  <td>{r.role}</td>
                  <td>
                    {r.role === "admin"
                      ? "All organization projects"
                      : (meta.grants || [])
                          .filter((g: R) => g.userId === r.id)
                          .map((g: R) => label("project", g.projectId))
                          .join(", ") || "No explicit grants"}
                    {(meta.payrollGrants || []).some(
                      (g: R) => g.userId === r.id,
                    ) && <small>Payroll enabled</small>}
                  </td>
                  <td>
                    {button("Edit access", "op:grants", {
                      userId: r.id,
                      projectIds: (meta.grants || [])
                        .filter((g: R) => g.userId === r.id)
                        .map((g: R) => g.projectId),
                      payroll: (meta.payrollGrants || []).some(
                        (g: R) => g.userId === r.id,
                      ),
                    })}
                  </td>
                </>
              ))}
              {table(
                ["Project", "Last published", ""],
                rows("project"),
                (r) => (
                  <>
                    <td>{r.name}</td>
                    <td>
                      {(ws.data.publication || [])
                        .filter((p: R) => p.projectId === r.id)
                        .at(-1)?.createdAt || "Unpublished"}
                    </td>
                    <td>
                      {editable && (
                        <button
                          onClick={() =>
                            call(
                              "publish",
                              { projectId: r.id },
                              "Viewer summary published",
                            )
                          }
                        >
                          Publish current summary
                        </button>
                      )}
                    </td>
                  </>
                ),
              )}
            </section>
          )}
          {meta.payroll && (
            <section className="panel">
              <div className="panel-head">
                <h2>Restricted effective labor rates</h2>
                {button("Add / update rate", "op:rate", { effective: day() })}
              </div>
              {table(
                ["Worker", "Effective", "Rate", "OT multiplier"],
                meta.rates || [],
                (r) => (
                  <>
                    <td>{label("worker", r.worker_id)}</td>
                    <td>{r.effective}</td>
                    <td>
                      {r.rate} {r.currency}
                    </td>
                    <td>{r.overtime_multiplier}</td>
                  </>
                ),
              )}
              <p>
                Rates stay in the restricted financial subsystem. Payroll
                exports require a date range, approved coded time, valid rates
                and explicit export confirmation.
              </p>
            </section>
          )}
          {admin && (
            <>
              <section className="panel">
                <div className="panel-head">
                  <h2>In-app dispatch</h2>
                  {editable && (
                    <button
                      onClick={() =>
                        call("dispatchSetting", {
                          enabled: !ws.data.settings?.[0]?.dispatch,
                          version: ws.data.settings?.[0]?.version,
                        })
                      }
                    >
                      {ws.data.settings?.[0]?.dispatch
                        ? "Enabled · disable"
                        : "Disabled · enable"}
                    </button>
                  )}
                </div>
                <p>
                  When enabled, assignment changes notify linked worker
                  accounts. Events are committed with the change, then delivered
                  independently with retry protection.
                </p>
                {table(
                  ["Event", "State", "Attempts", ""],
                  meta.events || [],
                  (r) => (
                    <>
                      <td>
                        {r.event_type}
                        <small>{r.created_at}</small>
                      </td>
                      <td>
                        {r.state}
                        <small>{r.error}</small>
                      </td>
                      <td>{r.attempts}</td>
                      <td>
                        {editable && r.state === "dead-letter" && (
                          <button
                            onClick={() => call("retryEvent", { id: r.id })}
                          >
                            Retry event
                          </button>
                        )}
                      </td>
                    </>
                  ),
                )}
              </section>
              <RetentionTools {...{ api, editable }} />
              <section className="panel">
                <h2>Organization data export</h2>
                <p>
                  Exports operational records, revisions and audit history. Use
                  the documented database backup command to include attachments
                  and account recovery.
                </p>
                <a
                  className="button"
                  href={BASE + "/api/v1/organization/export"}
                >
                  Download organization JSON
                </a>
              </section>
            </>
          )}
        </>
      )}
      {history && (
        <section className="panel">
          <div className="panel-head">
            <h2>Record history</h2>
            <button onClick={() => setHistory(null)}>Close history</button>
          </div>
          {history.revisions.map((rev: R) => (
            <details key={rev.version}>
              <summary>
                Revision {rev.version} ·{" "}
                {new Date(rev.record.updatedAt).toLocaleString()}
              </summary>
              <dl className="history-fields">
                {Object.entries(rev.record)
                  .filter(([k]) => !["id", "createdBy"].includes(k))
                  .map(([k, v]) => (
                    <div key={k}>
                      <dt>{k}</dt>
                      <dd>
                        {typeof v === "object"
                          ? JSON.stringify(v)
                          : String(v ?? "—")}
                      </dd>
                    </div>
                  ))}
              </dl>
            </details>
          ))}
        </section>
      )}
    </div>
  );
}
function PlanningTools({ ws, project, api, action, refresh }: R) {
  const [taskId, setTask] = useState(""),
    [start, setStart] = useState(day()),
    [end, setEnd] = useState(day()),
    [hours, setHours] = useState(8),
    [sat, setSat] = useState(false),
    [rate, setRate] = useState(0),
    [result, setResult] = useState<R[]>([]),
    [preview, setPreview] = useState<R | null>(null),
    [error, setError] = useState("");
  const projectId = project || ws.data.project[0]?.id;
  return (
    <section className="panel">
      <div className="panel-head">
        <h2>Calendar scenarios & reversible leveling</h2>
      </div>
      <div className="form-grid">
        <label>
          Task
          <select value={taskId} onChange={(e) => setTask(e.target.value)}>
            <option value="">Choose task</option>
            {ws.data.task
              .filter((t: R) => t.projectId === projectId)
              .map((t: R) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
          </select>
        </label>
        <label>
          Start
          <input
            type="date"
            value={start}
            onChange={(e) => setStart(e.target.value)}
          />
        </label>
        <label>
          Daily hours per worker
          <input
            type="number"
            min="1"
            max="16"
            value={hours}
            onChange={(e) => setHours(Number(e.target.value))}
          />
        </label>
        <label>
          Assumed hourly rate (scenario only)
          <input
            type="number"
            min="0"
            value={rate}
            onChange={(e) => setRate(Number(e.target.value))}
          />
        </label>
        <label className="check-label">
          <input
            type="checkbox"
            checked={sat}
            onChange={(e) => setSat(e.target.checked)}
          />
          Include Saturdays
        </label>
      </div>
      <button
        disabled={!taskId || ws.readOnly}
        onClick={() =>
          void Promise.all(
            [2, 4, 6].map((crew) =>
              api("/api/v1/planning/scenario", {
                projectId,
                taskId,
                start,
                hours,
                saturdays: sat,
                rate,
                crew,
              }),
            ),
          )
            .then(setResult)
            .catch((e: any) => setError(e.message))
        }
      >
        Compare crews of 2, 4 and 6
      </button>
      {result.length > 0 && (
        <div className="scenario-results">
          {result.map((r) => (
            <article key={r.crew}>
              <h3>{r.crew} workers</h3>
              <p>
                {r.finish ? `${r.start} → ${r.finish}` : "Finish unconfirmed"}
              </p>
              <p>
                {r.days} working days · {fmt(r.overtime)} overtime hours ·
                modeled cost {fmt(r.modeledCost)}
              </p>
              {r.constraints.map((c: string) => (
                <p className="danger-text" key={c}>
                  {c}
                </p>
              ))}
            </article>
          ))}
          <p>
            Simulation only. Crew availability is modeled, not reserved;
            receipts and material allocations remain required. Overtime is
            modeled after 8 hours per person per day.
          </p>
        </div>
      )}
      <hr />
      <label>
        Leveling search through
        <input
          type="date"
          value={end}
          onChange={(e) => setEnd(e.target.value)}
        />
      </label>
      <button
        disabled={ws.readOnly}
        onClick={() =>
          void api("/api/v1/planning/level-preview", {
            projectId,
            from: start,
            to: end,
          })
            .then(setPreview)
            .catch((e: any) => setError(e.message))
        }
      >
        Preview conflict moves
      </button>
      {preview && (
        <div>
          {!preview.suggestions.length ? (
            <p>No conflicting assignments in this range.</p>
          ) : (
            preview.suggestions.map((s: R) => (
              <p key={s.id}>
                {ws.data.worker.find((w: R) => w.id === s.workerId)?.name}:{" "}
                {s.before.date} → {s.after?.date || "No feasible date found"}
                <small>{s.reasons.join("; ")}</small>
              </p>
            ))
          )}
          {preview.suggestions.some((s: R) => s.after) && (
            <button
              onClick={() =>
                action(async () => {
                  await api("/api/v1/planning/level-apply", {
                    projectId,
                    from: start,
                    to: end,
                    token: preview.token,
                    selected: preview.suggestions
                      .filter((s: R) => s.after)
                      .map((s: R) => s.id),
                  });
                  setPreview(null);
                  await refresh();
                })
              }
            >
              Apply feasible suggestions
            </button>
          )}
        </div>
      )}
      {(ws.data.leveling || [])
        .filter((r: R) => r.projectId === projectId && r.status === "Applied")
        .map((r: R) => (
          <p key={r.id}>
            Applied {r.moves.length} moves · {r.createdAt}
            <button
              disabled={ws.readOnly}
              onClick={() =>
                action(() =>
                  api("/api/v1/planning/level-undo", {
                    id: r.id,
                    version: r.version,
                  }),
                )
              }
            >
              Undo batch
            </button>
          </p>
        ))}
      {error && (
        <p role="alert" className="danger-text">
          {error}
        </p>
      )}
    </section>
  );
}
function ReportTools({ ws, project, api }: R) {
  const [section, setSection] = useState(""),
    [from, setFrom] = useState(""),
    [to, setTo] = useState(""),
    [report, setReport] = useState<R | null>(null),
    [table, setTable] = useState("Materials"),
    [error, setError] = useState(""),
    [payroll, setPayroll] = useState(false);
  const params = new URLSearchParams({
    projectId: project,
    section,
    from,
    to,
    ...(payroll ? { payroll: "true", consent: "confirmed" } : {}),
  });
  const load = () =>
    void api("/api/v1/analytics/view?" + params)
      .then((r: R) => {
        setReport(r);
        if (!r.tables[table]) setTable(Object.keys(r.tables)[0]);
        setError("");
      })
      .catch((e: any) => setError(e.message));
  return (
    <section className="panel">
      <div className="panel-head">
        <div>
          <h2>Detailed operations reports</h2>
          <p>
            Filter by project above, then section and dates. Review the result
            before downloading.
          </p>
        </div>
      </div>
      <div className="form-grid">
        <label>
          Section
          <select value={section} onChange={(e) => setSection(e.target.value)}>
            <option value="">All sections</option>
            {[
              ...new Set(
                ws.data.task
                  .filter((t: R) => !project || t.projectId === project)
                  .map((t: R) => t.section),
              ),
            ].map((s: any) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </label>
        <label>
          From
          <input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
          />
        </label>
        <label>
          Through
          <input
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
          />
        </label>
        <label className="check-label">
          <input
            type="checkbox"
            checked={payroll}
            onChange={(e) => setPayroll(e.target.checked)}
          />
          Explicitly include validated payroll (restricted permission required)
        </label>
      </div>
      <button onClick={load}>Run report</button>
      {error && (
        <p role="alert" className="danger-text">
          {error}
        </p>
      )}
      {report && (
        <>
          <div className="actions">
            <select
              aria-label="Report table"
              value={table}
              onChange={(e) => setTable(e.target.value)}
            >
              {Object.keys(report.tables).map((t) => (
                <option key={t}>{t}</option>
              ))}
            </select>
            {["csv", "xlsx", "pdf", "json"].map((format) => (
              <a
                key={format}
                className="button"
                href={`${BASE}/api/v1/analytics/${format}?${params}&table=${encodeURIComponent(table)}`}
              >
                Download {format.toUpperCase()}
              </a>
            ))}
          </div>
          {(report.notes || []).map((s: string) => (
            <p key={s}>
              <small>{s}</small>
            </p>
          ))}
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  {Object.keys(report.tables[table]?.[0] || {}).map((c) => (
                    <th key={c}>{c}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(report.tables[table] || []).map((r: R, i: number) => (
                  <tr key={i}>
                    {Object.values(r).map((v: any, j) => (
                      <td key={j}>{fmt(v)}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
            {!report.tables[table]?.length && <p>No matching records.</p>}
          </div>
        </>
      )}
    </section>
  );
}
function RetentionTools({ api, editable }: R) {
  const [days, setDays] = useState(3650),
    [preview, setPreview] = useState<R | null>(null),
    [confirm, setConfirm] = useState(""),
    [message, setMessage] = useState("");
  return (
    <section className="panel">
      <h2>Attachment retention</h2>
      <p>
        Preview old files before deletion. Operational records, revisions and
        the audit ledger remain intact.
      </p>
      <label>
        Retain attachments for days
        <input
          type="number"
          min="30"
          value={days}
          onChange={(e) => {
            setDays(Number(e.target.value));
            setPreview(null);
          }}
        />
      </label>
      <button
        disabled={!editable}
        onClick={() =>
          void api("/api/v1/retention/preview", { days })
            .then(setPreview)
            .catch((e: any) => setMessage(e.message))
        }
      >
        Preview eligible files
      </button>
      {preview && (
        <>
          <p>
            {preview.attachments.length} files eligible (
            {preview.attachments
              .reduce((n: number, a: R) => n + a.bytes, 0)
              .toLocaleString()}{" "}
            bytes).
          </p>
          {preview.attachments.map((a: R) => (
            <p key={a.id}>
              {a.name} · {a.created_at}
            </p>
          ))}
          {preview.attachments.length > 0 && (
            <>
              <label>
                Type DELETE ATTACHMENTS to confirm this list
                <input
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                />
              </label>
              <button
                disabled={confirm !== "DELETE ATTACHMENTS"}
                onClick={() =>
                  void api("/api/v1/retention/apply", {
                    days,
                    token: preview.token,
                    confirm,
                  })
                    .then((r: R) => {
                      setMessage(`Deleted ${r.deleted} files.`);
                      setPreview(null);
                      setConfirm("");
                    })
                    .catch((e: any) => setMessage(e.message))
                }
              >
                Delete listed attachments
              </button>
            </>
          )}
        </>
      )}
      {message && <p role="status">{message}</p>}
    </section>
  );
}

export function ProcurementBoard({
  data,
  project,
}: {
  data: R;
  project: string;
}) {
  const scoped = (k: string) =>
    (data[k] || []).filter((r: R) => !project || r.projectId === project);
  const columns: Record<string, R[]> = {
    RFQs: scoped("rfq").map((r: R) => ({
      ...r,
      label:
        (data.part || []).find((p: R) => p.id === r.partId)?.partNumber ||
        "RFQ",
    })),
    Quoted: scoped("quote").map((r: R) => ({
      ...r,
      label:
        (data.part || []).find((p: R) => p.id === r.partId)?.partNumber ||
        "Quote",
    })),
    Draft: [],
    Ordered: [],
    Partial: [],
    Received: [],
    Backordered: [],
    Cancelled: [],
    Returned: [],
  };
  for (const po of scoped("po"))
    for (const l of po.lines) {
      const ms = scoped("movement").filter(
          (m: R) => m.poId === po.id && m.lineId === l.id,
        ),
        received = ms.reduce((n: number, m: R) => n + (m.received || 0), 0),
        returned = ms
          .filter((m: R) => m.action === "return")
          .reduce((n: number, m: R) => n + m.quantity, 0),
        stage =
          po.status === "Cancelled"
            ? "Cancelled"
            : ["Draft", "Submitted", "Approved"].includes(po.status)
              ? "Draft"
              : received >= l.quantity
                ? "Received"
                : l.backordered
                  ? "Backordered"
                  : received
                    ? "Partial"
                    : "Ordered";
      const card = {
        id: po.id + l.id,
        label:
          po.number +
          " · " +
          ((data.part || []).find((p: R) => p.id === l.partId)?.partNumber ||
            ""),
        quantity: l.quantity,
        received,
        eta: l.confirmedETA || "Unconfirmed",
      };
      columns[stage].push(card);
      if (returned) columns.Returned.push({ ...card, quantity: returned });
    }
  return (
    <section className="procurement-board" aria-label="Procurement stages">
      {Object.entries(columns).map(([name, items]) => (
        <div key={name}>
          <h3>
            {name} <span>{items.length}</span>
          </h3>
          {items.map((r) => (
            <article key={r.id}>
              <strong>{r.label}</strong>
              <small>
                {r.received != null ? r.received + " / " : ""}
                {r.quantity} units
              </small>
              <small>{r.eta || r.status}</small>
            </article>
          ))}
          {!items.length && <p>—</p>}
        </div>
      ))}
    </section>
  );
}
