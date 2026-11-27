import React, { useState } from "react";
type R = Record<string, any>;
export function Intake({
  ws,
  project,
  api,
  refresh,
}: {
  ws: R;
  project: string;
  api: (p: string, b?: any) => Promise<any>;
  refresh: () => Promise<any>;
}) {
  const buyer = ["admin", "purchasing"].includes(ws.actor.role),
    manager = ["admin", "pm"].includes(ws.actor.role);
  const [mode, setMode] = useState(buyer ? "po" : "estimate"),
    [rawRows, setRawRows] = useState<R[]>([]),
    [mapping, setMapping] = useState<R>({}),
    [mapped, setMapped] = useState<R[]>([]),
    [input, setInput] = useState<R>({
      projectId: project || ws.data.project[0]?.id || "",
      supplierId: ws.data.supplier[0]?.id || "",
      number: "",
      source: "",
      sourceVersion: "",
      currency: "USD",
      freight: 0,
      tax: 0,
      estimateId: "",
      sourceHash: "",
      fieldBudget: 0,
      pmBudget: 0,
    }),
    [allocations, setAllocations] = useState<R[]>([]),
    [preview, setPreview] = useState<R | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [confirmed, setConfirmed] = useState(false),
    [message, setMessage] = useState("");
  const fields =
    mode === "po"
      ? [
          "externalLineId",
          "taskId",
          "partNumber",
          "manufacturer",
          "unit",
          "quantity",
          "unitCost",
          "confirmedETA",
          "leadMin",
          "leadMax",
          "ackDate",
        ]
      : [
          "sourceLineId",
          "partNumber",
          "manufacturer",
          "description",
          "unit",
          "quantity",
          "taskId",
          "needBy",
          "conversionId",
        ];
  const set = (k: string, v: any) => {
    setInput({ ...input, [k]: v });
    setPreview(null);
    setConfirmed(false);
  };
  const change = (i: number, k: string, v: any) => {
    setMapped(mapped.map((r, j) => (i === j ? { ...r, [k]: v } : r)));
    setPreview(null);
    setConfirmed(false);
  };
  const run = async (fn: () => Promise<void>) => {
    setError("");
    setBusy(true);
    try {
      await fn();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };
  const payload = () => ({ ...input, rows: mapped, allocations });
  return (
    <section className="panel">
      <div className="panel-head">
        <div>
          <h2>Reviewed source intake</h2>
          <p>
            Import external orders or estimate materials and labor budgets.
            Files remain local to this installation. Existing issued orders
            become amendment proposals; estimates never approve production or
            change baseline dates.
          </p>
        </div>
      </div>
      <div className="form-grid">
        <label>
          Import workflow
          <select
            value={mode}
            onChange={(e) => {
              setMode(e.target.value);
              setRawRows([]);
              setMapped([]);
              setPreview(null);
              setMessage("");
            }}
          >
            {buyer && <option value="po">External purchase order</option>}
            {manager && (
              <option value="estimate">Estimate → materials and labor</option>
            )}
          </select>
        </label>
        <label>
          Project
          <select
            value={input.projectId}
            onChange={(e) => {
              set("projectId", e.target.value);
              setAllocations([]);
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
          Source reference
          <input
            value={input.source}
            onChange={(e) => set("source", e.target.value)}
          />
        </label>
        <label>
          Source revision
          <input
            required
            value={input.sourceVersion}
            onChange={(e) => set("sourceVersion", e.target.value)}
          />
        </label>
        {mode === "po" ? (
          <>
            <label>
              Supplier
              <select
                value={input.supplierId}
                onChange={(e) => set("supplierId", e.target.value)}
              >
                {ws.data.supplier.map((s: R) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              External PO number
              <input
                value={input.number}
                onChange={(e) => set("number", e.target.value)}
              />
            </label>
            <label>
              Currency
              <select
                value={input.currency}
                onChange={(e) => set("currency", e.target.value)}
              >
                {["USD", "CAD", "EUR", "GBP"].map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
            </label>
            {["freight", "tax"].map((k) => (
              <label key={k}>
                {k}
                <input
                  type="number"
                  min="0"
                  step="any"
                  value={input[k]}
                  onChange={(e) => set(k, Number(e.target.value))}
                />
              </label>
            ))}
          </>
        ) : (
          <>
            <label>
              Estimate ID
              <input
                value={input.estimateId}
                onChange={(e) => set("estimateId", e.target.value)}
              />
            </label>
            {["fieldBudget", "pmBudget"].map((k) => (
              <label key={k}>
                {k === "fieldBudget"
                  ? "Reviewed whole-project field hours"
                  : "Reviewed whole-project PM hours"}
                <input
                  type="number"
                  min="0"
                  step="any"
                  value={input[k]}
                  onChange={(e) => set(k, Number(e.target.value))}
                />
              </label>
            ))}
          </>
        )}
        <label>
          Source file (CSV, XLSX or JSON)
          <input
            type="file"
            accept=".csv,.xlsx,.json"
            disabled={busy || ws.readOnly}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              void run(async () => {
                if (file.size > 8000000)
                  throw new Error("Maximum file size is 8 MB");
                let result: R, rows: R[];
                if (file.name.toLowerCase().endsWith(".json")) {
                  const source = JSON.parse(await file.text());
                  if (mode === "estimate") {
                    result = await api("/api/v1/intake/decode", {
                      mode: "estimate-json",
                      source,
                    });
                    rows = result.lines.filter((r: R) => !r.excluded);
                    setMessage(
                      result.notes +
                        ` ${result.lines.length - rows.length} excluded indirect/deleted rows.`,
                    );
                  } else {
                    rows = Array.isArray(source) ? source : source.lines;
                    result = {};
                  }
                } else {
                  const bytes = new Uint8Array(await file.arrayBuffer());
                  let binary = "";
                  for (let i = 0; i < bytes.length; i += 32768)
                    binary += String.fromCharCode(
                      ...bytes.subarray(i, i + 32768),
                    );
                  result = await api("/api/v1/intake/decode", {
                    base64: btoa(binary),
                    format: file.name.toLowerCase().endsWith(".xlsx")
                      ? "xlsx"
                      : "csv",
                  });
                  rows = result.rows;
                }
                if (!Array.isArray(rows) || !rows.length)
                  throw new Error("File requires nonempty rows");
                const hash = Array.from(
                  new Uint8Array(
                    await crypto.subtle.digest(
                      "SHA-256",
                      await file.arrayBuffer(),
                    ),
                  ),
                )
                  .map((b) => b.toString(16).padStart(2, "0"))
                  .join("");
                setInput((v) => ({
                  ...v,
                  source: file.name,
                  sourceHash: hash,
                  estimateId: result.estimateId || v.estimateId,
                  sourceVersion: result.sourceVersion || v.sourceVersion,
                  fieldBudget: result.fieldBudget ?? v.fieldBudget,
                  pmBudget: result.pmBudget ?? v.pmBudget,
                }));
                setRawRows(rows);
                setMapped(rows);
                setMapping(Object.fromEntries(fields.map((k) => [k, k])));
                setPreview(null);
                setConfirmed(false);
              });
            }}
          />
        </label>
      </div>
      {rawRows.length > 0 && (
        <>
          <h3>Map source columns</h3>
          <p>
            Missing units and task IDs require explicit selection. Use the
            source line ID to preserve order-line identity across revisions.
          </p>
          <div className="form-grid">
            {fields.map((k) => (
              <label key={k}>
                {k}
                <select
                  value={mapping[k] || ""}
                  onChange={(e) => {
                    setMapping({ ...mapping, [k]: e.target.value });
                    setPreview(null);
                  }}
                >
                  <option value="">Set manually below</option>
                  {Object.keys(rawRows[0]).map((h) => (
                    <option key={h}>{h}</option>
                  ))}
                </select>
              </label>
            ))}
          </div>
          <button
            onClick={() => {
              setMapped(
                rawRows.map((r, i) =>
                  Object.fromEntries(
                    fields.map((k) => [
                      k,
                      mapping[k]
                        ? (r[mapping[k]] ?? "")
                        : k === "sourceLineId"
                          ? String(i + 1)
                          : "",
                    ]),
                  ),
                ),
              );
              setPreview(null);
              setConfirmed(false);
            }}
          >
            Apply column mapping
          </button>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Row</th>
                  {fields.map((k) => (
                    <th key={k}>{k}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {mapped.map((r, i) => (
                  <tr key={i}>
                    <th>{i + 1}</th>
                    {fields.map((k) => (
                      <td key={k}>
                        {k === "unit" ? (
                          <select
                            aria-label={`Row ${i + 1} unit`}
                            value={r[k] || ""}
                            onChange={(e) => change(i, k, e.target.value)}
                          >
                            <option value="">Choose unit</option>
                            {["ea", "ft", "m", "box", "roll", "hr"].map((u) => (
                              <option key={u}>{u}</option>
                            ))}
                          </select>
                        ) : k === "taskId" ? (
                          <select
                            aria-label={`Row ${i + 1} task`}
                            value={r[k] || ""}
                            onChange={(e) => change(i, k, e.target.value)}
                          >
                            <option value="">Choose task</option>
                            {ws.data.task
                              .filter((t: R) => t.projectId === input.projectId)
                              .map((t: R) => (
                                <option key={t.id} value={t.id}>
                                  {t.name} · {t.section}
                                </option>
                              ))}
                          </select>
                        ) : (
                          <input
                            aria-label={`Row ${i + 1} ${k}`}
                            style={{ minWidth: 100 }}
                            value={r[k] ?? ""}
                            onChange={(e) => change(i, k, e.target.value)}
                          />
                        )}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {mode === "estimate" && (
            <>
              <h3>Explicit task budget allocations</h3>
              <p>
                Whole-project hours remain unallocated until you add an
                allocation here. Existing allocations are retained unless
                explicitly revised. Unit production standards remain separate.
              </p>
              {allocations.map((r, i) => (
                <div className="actions" key={i}>
                  <select
                    aria-label={`Allocation ${i + 1} task`}
                    value={r.taskId}
                    onChange={(e) => {
                      setAllocations(
                        allocations.map((x, j) =>
                          j === i ? { ...x, taskId: e.target.value } : x,
                        ),
                      );
                      setPreview(null);
                    }}
                  >
                    <option value="">Choose task</option>
                    {ws.data.task
                      .filter((t: R) => t.projectId === input.projectId)
                      .map((t: R) => (
                        <option key={t.id} value={t.id}>
                          {t.name} · {t.laborType}
                        </option>
                      ))}
                  </select>
                  <input
                    aria-label={`Allocation ${i + 1} hours`}
                    type="number"
                    min="0"
                    value={r.hours}
                    onChange={(e) => {
                      setAllocations(
                        allocations.map((x, j) =>
                          j === i ? { ...x, hours: Number(e.target.value) } : x,
                        ),
                      );
                      setPreview(null);
                    }}
                  />
                  <button
                    onClick={() => {
                      setAllocations(allocations.filter((_, j) => j !== i));
                      setPreview(null);
                    }}
                  >
                    Remove allocation
                  </button>
                </div>
              ))}
              <button
                onClick={() => {
                  setAllocations([...allocations, { taskId: "", hours: 0 }]);
                  setPreview(null);
                }}
              >
                Add task allocation
              </button>
            </>
          )}
          <button
            className="primary"
            disabled={busy || ws.readOnly}
            onClick={() =>
              void run(async () => {
                setPreview(
                  await api(`/api/v1/intake/${mode}/preview`, payload()),
                );
                setConfirmed(false);
              })
            }
          >
            Review import
          </button>
        </>
      )}
      {preview && (
        <>
          <h3>
            {preview.action || "Estimate revision"} · review before applying
          </h3>
          {preview.previousBudget && (
            <p>
              Project field hours: {preview.previousBudget.field} →{" "}
              {input.fieldBudget}. PM hours: {preview.previousBudget.pm} →{" "}
              {input.pmBudget}.
            </p>
          )}
          {preview.errors.map((s: string) => (
            <p className="error" key={s}>
              {s}
            </p>
          ))}
          {(preview.lines || preview.rows).map((r: R) => (
            <p key={r.index}>
              Row {r.index}:{" "}
              {r.errors.length ? r.errors.join("; ") : "Validated"}
              {r.previousQuantity != null
                ? ` · requirement ${r.previousQuantity} → ${r.normalizedQuantity}`
                : ""}
            </p>
          ))}
          <label className="check">
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(e) => setConfirmed(e.target.checked)}
            />
            I reviewed quantities, units, source revision, budgets and proposed
            changes.
          </label>
          <button
            disabled={
              !confirmed ||
              busy ||
              preview.errors.length > 0 ||
              (preview.lines || preview.rows).some((r: R) => r.errors.length)
            }
            onClick={() =>
              void run(async () => {
                const r = await api(`/api/v1/intake/${mode}/commit`, {
                  ...payload(),
                  token: preview.token,
                });
                setMessage(
                  mode === "po"
                    ? `${r.action} saved. Continue its approval workflow in Purchases.`
                    : `Imported ${r.materials} material rows and ${r.allocations} explicit task allocations.`,
                );
                setPreview(null);
                setRawRows([]);
                setMapped([]);
                await refresh();
              })
            }
          >
            Apply reviewed import
          </button>
        </>
      )}
      {busy && <p role="status">Processing source…</p>}
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {message && <p role="status">{message}</p>}
    </section>
  );
}
