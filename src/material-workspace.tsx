import React, { useEffect, useState } from "react";
type R = Record<string, any>;
type Api = (path: string, body?: any, method?: string) => Promise<any>;
const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
const n = (v: any) =>
  v == null
    ? "—"
    : Number(v).toLocaleString(undefined, { maximumFractionDigits: 2 });
const money = (v: number, c: string) =>
  new Intl.NumberFormat(undefined, { style: "currency", currency: c }).format(
    v,
  );
export function MaterialWorkspace({
  ws,
  project,
  api,
  onEdit,
}: {
  ws: R;
  project: string;
  api: Api;
  onEdit?: (r: R) => void;
}) {
  const [state, setState] = useState<R>({ lines: [], tasks: [] }),
    [filters, setFilters] = useState<R>({
      search: "",
      section: "",
      supplier: "",
      po: "",
      status: "",
      risk: "",
      needBy: "",
    }),
    [error, setError] = useState(""),
    [history, setHistory] = useState<R | null>(null);
  useEffect(() => {
    let alive = true;
    api(`/api/v1/materials/workspace?projectId=${encodeURIComponent(project)}`)
      .then((v) => {
        if (alive) {
          setState(v);
          setError("");
        }
      })
      .catch((e) => alive && setError(e.message));
    return () => {
      alive = false;
    };
  }, [project, ws]);
  const lines = state.lines.filter(
    (r: R) =>
      (!filters.search ||
        [r.partNumber, r.description, r.manufacturer, r.taskName, r.source]
          .join(" ")
          .toLowerCase()
          .includes(filters.search.toLowerCase())) &&
      (!filters.section || r.section === filters.section) &&
      (!filters.supplier ||
        r.orders.some((o: R) => o.supplierId === filters.supplier) ||
        r.quotes.some((q: R) => q.supplierId === filters.supplier)) &&
      (!filters.po || r.orders.some((o: R) => o.poId === filters.po)) &&
      (!filters.status || r.taskStatus === filters.status) &&
      (!filters.risk || r.risk === filters.risk) &&
      (!filters.needBy || (r.needBy && r.needBy <= filters.needBy)),
  );
  const taskIds = new Set(lines.map((r: R) => r.taskId)),
    tasks = state.tasks.filter((t: R) => taskIds.has(t.taskId)),
    ready = tasks.filter((t: R) => t.status === "Ready").length;
  const cost = ["admin", "purchasing"].includes(ws.actor.role);
  return (
    <>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      <div className="material-filters">
        <label>
          Search
          <input
            value={filters.search}
            onChange={(e) => setFilters({ ...filters, search: e.target.value })}
            placeholder="Part, manufacturer, task or source"
          />
        </label>
        {(
          [
            [
              "section",
              "Section",
              [...new Set(state.lines.map((r: R) => r.section))].map((v) => ({
                id: v,
                label: v,
              })),
            ],
            [
              "supplier",
              "Supplier",
              (ws.data.supplier || []).map((r: R) => ({
                id: r.id,
                label: r.name,
              })),
            ],
            [
              "po",
              "PO",
              (ws.data.po || [])
                .filter((r: R) => !project || r.projectId === project)
                .map((r: R) => ({ id: r.id, label: r.number })),
            ],
            [
              "status",
              "Task status",
              ["Ready", "Partial", "Blocked", "Unconfirmed"].map((v) => ({
                id: v,
                label: v,
              })),
            ],
            [
              "risk",
              "Risk",
              [
                "Ready",
                "Late delivery",
                "Awaiting delivery",
                "ETA unconfirmed",
              ].map((v) => ({ id: v, label: v })),
            ],
          ] as any[]
        ).map(([key, label, options]) => (
          <label key={key}>
            {label}
            <select
              value={filters[key]}
              onChange={(e) =>
                setFilters({ ...filters, [key]: e.target.value })
              }
            >
              <option value="">All</option>
              {options.map((v: R) => (
                <option key={v.id} value={v.id}>
                  {v.label}
                </option>
              ))}
            </select>
          </label>
        ))}
        <label>
          Needed by
          <input
            type="date"
            value={filters.needBy}
            onChange={(e) => setFilters({ ...filters, needBy: e.target.value })}
          />
        </label>
      </div>
      <div className="material-layout">
        <section className="panel material-grid">
          <div className="panel-head">
            <div>
              <h2>Material requirements</h2>
              <p>
                On hand and available are shared warehouse totals. Reserved is
                task-specific; ordered and received are project totals.
                Quantities in different units are never summed.
              </p>
            </div>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  {[
                    "Part / manufacturer",
                    "Description",
                    "Unit",
                    "Task · section",
                    "Required",
                    "On hand",
                    "Ordered",
                    "Received",
                    "Reserved",
                    "Available",
                    "Covered",
                    "Shortage",
                    "Vendor · quote / PO",
                    "Acknowledged lead time",
                    "Forecast ETA range",
                    "Confirmed ETA",
                    ...(cost ? ["Quoted / ordered price"] : []),
                    "Need by",
                    "Approval / risk",
                    "Notes / provenance",
                    "",
                  ].map((h) => (
                    <th key={h}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {lines.map((r: R) => (
                  <tr key={r.id}>
                    <td>
                      <strong>{r.partNumber}</strong>
                      <small>{r.manufacturer || "—"}</small>
                    </td>
                    <td>{r.description}</td>
                    <td>{r.unit}</td>
                    <td>
                      {r.taskName}
                      <small>{r.section}</small>
                    </td>
                    {[
                      "quantity",
                      "onHand",
                      "ordered",
                      "received",
                      "reserved",
                      "available",
                      "coverage",
                      "shortage",
                    ].map((k) => (
                      <td
                        key={k}
                        className={
                          k === "shortage" && r[k] ? "danger-text" : ""
                        }
                      >
                        {n(r[k])}
                      </td>
                    ))}
                    <td>
                      {r.orders.map((o: R) => (
                        <small key={o.id}>
                          {o.supplier} · {o.number}
                        </small>
                      ))}
                      {r.quotes.map((q: R) => (
                        <small key={q.id}>
                          {
                            ws.data.supplier.find(
                              (s: R) => s.id === q.supplierId,
                            )?.name
                          }{" "}
                          · quote {q.source || q.id.slice(0, 8)}
                        </small>
                      ))}
                    </td>
                    <td>
                      {r.orders.map((o: R) => (
                        <small key={o.id}>
                          {o.number}:{" "}
                          {o.ackDate
                            ? `${o.leadMin}–${o.leadMax} days ARO · ${o.ackDate}`
                            : "Unacknowledged"}
                        </small>
                      ))}
                    </td>
                    <td>
                      {r.orders.map((o: R) => (
                        <small key={o.id}>
                          {o.number}:{" "}
                          {o.forecastFrom
                            ? `${o.forecastFrom} – ${o.forecastTo}`
                            : "Unconfirmed"}
                        </small>
                      ))}
                    </td>
                    <td>
                      {r.orders.map((o: R) => (
                        <small key={o.id}>
                          {o.number}: {o.confirmedETA || "Unconfirmed"}
                        </small>
                      ))}
                    </td>
                    {cost && (
                      <td>
                        {r.quotes.map((q: R) => (
                          <small key={q.id}>
                            Quote: {money(q.unitCost, q.currency)} / {q.unit}
                          </small>
                        ))}
                        {r.orders.map((o: R) => (
                          <small key={o.id}>
                            {o.number}: {money(o.unitCost, o.currency)} /{" "}
                            {r.unit}
                          </small>
                        ))}
                      </td>
                    )}
                    <td>{r.needBy || "Unscheduled"}</td>
                    <td>
                      {r.risk}
                      {r.orders.map((o: R) => (
                        <small key={o.id}>
                          {o.number}: {o.status}
                        </small>
                      ))}
                    </td>
                    <td>
                      {r.notes || "—"}
                      <small>
                        {r.source} · {r.sourceVersion}
                      </small>
                    </td>
                    <td>
                      <button
                        onClick={() =>
                          void api(
                            `/api/v1/materials/timeline?projectId=${encodeURIComponent(r.projectId)}&partId=${encodeURIComponent(r.partId)}`,
                          )
                            .then(setHistory)
                            .catch((e) => setError(e.message))
                        }
                      >
                        History & files
                      </button>
                      {onEdit && (
                        <button onClick={() => onEdit(r)}>
                          Revise requirement
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!lines.length && (
            <p className="empty-note">No matching material requirements.</p>
          )}
        </section>
        <aside className="panel readiness-panel">
          <h2>Task readiness</h2>
          <strong className="readiness-number">
            {tasks.length ? n((100 * ready) / tasks.length) : "—"}%
          </strong>
          <p>
            {ready} of {tasks.length} matching tasks ready
          </p>
          <h3>Critical blockers</h3>
          {lines
            .filter((r: R) => r.criticality === "critical" && r.shortage > 0)
            .map((r: R) => (
              <p key={r.id}>
                <strong>{r.partNumber}</strong>
                <br />
                {r.taskName}: {n(r.shortage)} {r.unit} short · {r.risk}
              </p>
            ))}
          {tasks
            .filter((t: R) => t.status !== "Ready")
            .map((t: R) => (
              <p key={t.taskId}>
                <strong>{t.name}</strong>
                <br />
                {t.reason}
                {(t.holds || []).map((h: R) => (
                  <small key={h.id}>{h.reason}</small>
                ))}
              </p>
            ))}
          {tasks.length > 0 && ready === tasks.length && (
            <p>All matching tasks have their required materials covered.</p>
          )}
        </aside>
      </div>
      {history && (
        <div className="modal-backdrop">
          <section
            className="modal wide"
            role="dialog"
            aria-modal="true"
            aria-label="Material history"
          >
            <header>
              <h2>{history.part.partNumber} · history & files</h2>
              <button
                onClick={() => setHistory(null)}
                aria-label="Close material history"
              >
                Close
              </button>
            </header>
            <p>
              Linked records and saved revisions for this project. Supplier
              records and documents require purchasing access.
            </p>
            <h3>Evidence files</h3>
            {history.attachments.length ? (
              history.attachments.map((f: R) => (
                <p key={f.id}>
                  <a href={`${BASE}/api/v1/attachments/${f.id}`}>{f.name}</a> ·{" "}
                  {f.kind} · {f.created_at}
                </p>
              ))
            ) : (
              <p>No linked evidence files.</p>
            )}
            <h3>Transaction timeline</h3>
            {history.entries.map((e: R) => (
              <details key={e.id}>
                <summary>
                  {e.at} · {e.kind} ·{" "}
                  {e.record.action || e.record.status || "Saved"} · revision{" "}
                  {e.record.version}
                </summary>
                <pre>{JSON.stringify(e.record, null, 2)}</pre>
              </details>
            ))}
          </section>
        </div>
      )}
    </>
  );
}
export function QuoteComparison({
  ws,
  project,
  api,
  open,
}: {
  ws: R;
  project: string;
  api: Api;
  open: (kind: string, defaults?: R) => void;
}) {
  const [criteria, setCriteria] = useState<R>({
      projectId: project || ws.data.project[0]?.id || "",
      partId: ws.data.part[0]?.id || "",
      taskId: "",
      quantity: 1,
      currency: "USD",
    }),
    [result, setResult] = useState<R | null>(null),
    [error, setError] = useState("");
  useEffect(() => {
    setCriteria((v) => ({
      ...v,
      projectId: project || ws.data.project[0]?.id || "",
      taskId: "",
    }));
    setResult(null);
  }, [project, ws]);
  const field = (key: string, value: any) => {
    setCriteria({ ...criteria, [key]: value });
    setResult(null);
  };
  return (
    <section className="panel">
      <div className="panel-head">
        <div>
          <h2>Compare equivalent quotes</h2>
          <p>
            Match quantity, catalog unit and currency. Approved alternatives
            apply only to the selected task. Freight and tax must be quoted for
            the requested quantity.
          </p>
        </div>
      </div>
      <form
        className="material-filters"
        onSubmit={(e) => {
          e.preventDefault();
          setError("");
          void api(
            "/api/v1/materials/compare?" + new URLSearchParams(criteria as any),
          )
            .then(setResult)
            .catch((e) => setError(e.message));
        }}
      >
        <label>
          Project
          <select
            required
            value={criteria.projectId}
            onChange={(e) => {
              field("projectId", e.target.value);
              setCriteria((v) => ({ ...v, taskId: "" }));
            }}
          >
            {ws.data.project.map((p: R) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Part
          <select
            required
            value={criteria.partId}
            onChange={(e) => field("partId", e.target.value)}
          >
            {ws.data.part.map((p: R) => (
              <option key={p.id} value={p.id}>
                {p.partNumber} · {p.unit}
              </option>
            ))}
          </select>
        </label>
        <label>
          Task for alternate approval
          <select
            value={criteria.taskId}
            onChange={(e) => field("taskId", e.target.value)}
          >
            <option value="">Exact part only</option>
            {ws.data.task
              .filter((t: R) => t.projectId === criteria.projectId)
              .map((t: R) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
          </select>
        </label>
        <label>
          Required quantity
          <input
            required
            type="number"
            min="0.000001"
            step="any"
            value={criteria.quantity}
            onChange={(e) => field("quantity", Number(e.target.value))}
          />
        </label>
        <label>
          Currency
          <select
            value={criteria.currency}
            onChange={(e) => field("currency", e.target.value)}
          >
            {["USD", "CAD", "EUR", "GBP"].map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </label>
        <button type="submit">Compare quotes</button>
      </form>
      {error && <p role="alert">{error}</p>}
      {result && (
        <>
          <p>
            {result.rows.filter((r: R) => !r.reasons.length).length} comparable
            offers · {result.criteria.quantity} {result.criteria.unit} ·{" "}
            {result.criteria.currency}
          </p>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  {[
                    "Supplier / part",
                    "Quoted quantity",
                    "Unit price / tier",
                    "Freight + tax",
                    "Landed total",
                    "Request / response",
                    "Approval / validity",
                    "Selection",
                  ].map((h) => (
                    <th key={h}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {result.rows.map((q: R) => (
                  <tr key={q.id}>
                    <td>
                      {q.supplier}
                      <small>
                        {q.partNumber}
                        {q.alternate ? " · approved task alternative" : ""}
                      </small>
                    </td>
                    <td>
                      {q.quantity} {q.unit}
                    </td>
                    <td>{money(q.effectiveUnitCost, q.currency)}</td>
                    <td>
                      {money(q.freight, q.currency)} +{" "}
                      {money(q.tax, q.currency)}
                    </td>
                    <td>
                      {q.landedTotal == null
                        ? "Not comparable"
                        : money(q.landedTotal, q.currency)}
                    </td>
                    <td>
                      {q.requestDate || "Not recorded"}
                      <small>{q.responseDate || "Not recorded"}</small>
                    </td>
                    <td>
                      {q.status || "Quoted"}
                      <small>{q.validUntil || "No expiry specified"}</small>
                    </td>
                    <td>
                      {q.reasons.map((r: string) => (
                        <small key={r}>{r}</small>
                      ))}
                      {!q.reasons.length &&
                        q.status === "Approved" &&
                        !ws.readOnly && (
                          <button
                            onClick={() =>
                              open("op:quoteToPo", {
                                id: q.id,
                                quantity: criteria.quantity,
                              })
                            }
                          >
                            Create PO from approved offer
                          </button>
                        )}
                      {!q.reasons.length && q.status !== "Approved" && (
                        <small>Approval required before ordering</small>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!result.rows.length && (
            <p>No matching part or approved task-alternative quotes.</p>
          )}
        </>
      )}
    </section>
  );
}
