import { WorkspaceSwitcher } from "./tenants";
import React, { useState } from "react";
type R = Record<string, any>;
const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
export function VendorPortal({
  ws,
  api,
  refresh,
  signOut,
}: {
  ws: R;
  api: (p: string, b?: any) => Promise<any>;
  refresh: () => Promise<any>;
  signOut: () => void;
}) {
  const [selected, setSelected] = useState<R | null>(null),
    [form, setForm] = useState<R>({}),
    [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [files, setFiles] = useState<R[]>([]),
    [evidence, setEvidence] = useState<R | null>(null),
    [busy, setBusy] = useState(false);
  const part = (id: string) => ws.data.part.find((p: R) => p.id === id),
    project = (id: string) =>
      ws.data.project.find((p: R) => p.id === id)?.name || id;
  const run = async (fn: () => Promise<any>) => {
    setBusy(true);
    setError("");
    try {
      await fn();
      await refresh();
      setMessage("Saved successfully");
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };
  const showFiles = async (kind: string, id: string) => {
    setEvidence({ kind, id });
    setFiles(await api(`/api/v1/attachments?kind=${kind}&id=${id}`));
  };
  const field = (k: string, v: any) => setForm({ ...form, [k]: v });
  return (
    <main className="vendor-portal">
      <WorkspaceSwitcher
        ws={ws}
        api={api}
        onSwitch={() => {
          setSelected(null);
          setEvidence(null);
          setFiles([]);
          setError("");
          setMessage("");
          void refresh();
        }}
      />
      <header className="page-heading">
        <div>
          <span className="eyebrow">CAS FIELDOPS · APPROVED SUPPLIER</span>
          <h1>{ws.data.supplier[0]?.name || "Supplier portal"}</h1>
          <p>
            Requests, purchase orders and delivery confirmations shared with
            your account.
          </p>
        </div>
        <button onClick={signOut}>Sign out</button>
      </header>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {message && <p role="status">{message}</p>}
      <section className="panel">
        <div className="panel-head">
          <h2>Requests for quote</h2>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Project</th>
                <th>Part</th>
                <th>Quantity / need by</th>
                <th>Response</th>
              </tr>
            </thead>
            <tbody>
              {ws.data.rfq.map((r: R) => (
                <tr key={r.id}>
                  <td>{project(r.projectId)}</td>
                  <td>{part(r.partId)?.partNumber}</td>
                  <td>
                    {r.quantity} {part(r.partId)?.unit}
                    <small>{r.needBy || "Unspecified"}</small>
                  </td>
                  <td>
                    <button
                      onClick={() => {
                        setSelected({ ...r, kind: "quote" });
                        setForm({
                          quantity: r.quantity,
                          unitCost: 0,
                          freight: 0,
                          tax: 0,
                          currency: "USD",
                          leadMin: 0,
                          leadMax: 0,
                          validUntil: "",
                          responseDate: new Date().toISOString().slice(0, 10),
                        });
                      }}
                    >
                      Respond with quote
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!ws.data.rfq.length && (
          <p className="empty-note">
            No RFQs have been shared with this account.
          </p>
        )}
      </section>
      <section className="panel">
        <div className="panel-head">
          <h2>Your quotes</h2>
        </div>
        {ws.data.quote.map((r: R) => (
          <article className="vendor-record" key={r.id}>
            <strong>
              {part(r.partId)?.partNumber} · {project(r.projectId)}
            </strong>
            <p>
              {r.quantity} {r.unit} · {r.currency} {r.unitCost}/unit ·{" "}
              {r.status || "Quoted"}
            </p>
            <button onClick={() => void run(() => showFiles("quote", r.id))}>
              Quote documents
            </button>
          </article>
        ))}
      </section>
      <section className="panel">
        <div className="panel-head">
          <h2>Purchase orders & deliveries</h2>
        </div>
        {ws.data.po.map((p: R) => (
          <article className="vendor-record" key={p.id}>
            <h3>
              {p.number} · {project(p.projectId)} · {p.status}
            </h3>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Part</th>
                    <th>Ordered / received</th>
                    <th>Unit price</th>
                    <th>Confirmed ETA</th>
                  </tr>
                </thead>
                <tbody>
                  {p.lines.map((l: R) => (
                    <tr key={l.id}>
                      <td>{part(l.partId)?.partNumber}</td>
                      <td>
                        {l.quantity} / {l.netReceived} {part(l.partId)?.unit}
                      </td>
                      <td>
                        {p.currency} {l.unitCost}
                      </td>
                      <td>{l.confirmedETA || "Unconfirmed"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="actions">
              <button onClick={() => void run(() => showFiles("po", p.id))}>
                Shared PO documents
              </button>
              {["Issued", "Acknowledged"].includes(p.status) && (
                <>
                  <button
                    onClick={() => {
                      setSelected({ ...p, kind: "promise" });
                      setForm({
                        lines: p.lines.map((l: R) => ({
                          id: l.id,
                          confirmedETA: l.confirmedETA || "",
                          ackDate:
                            l.ackDate || new Date().toISOString().slice(0, 10),
                        })),
                      });
                    }}
                  >
                    Acknowledge / confirm dates
                  </button>
                  <button
                    onClick={() => {
                      setSelected({ ...p, kind: "shipment" });
                      setForm({
                        reference: "",
                        carrier: "",
                        tracking: "",
                        expectedDate: "",
                        lineId: p.lines[0]?.id,
                        quantity: 1,
                      });
                    }}
                  >
                    Record split shipment
                  </button>
                </>
              )}
            </div>
          </article>
        ))}
      </section>
      <section className="panel">
        <div className="panel-head">
          <h2>Shipment confirmations</h2>
        </div>
        {ws.data.shipment.map((r: R) => (
          <article className="vendor-record" key={r.id}>
            <strong>
              {r.reference || "Shipment"} · {r.carrier} · {r.tracking}
            </strong>
            <p>
              {r.status} · expected {r.expectedDate || "unconfirmed"}
            </p>
            <button onClick={() => void run(() => showFiles("shipment", r.id))}>
              Shipment documents
            </button>
            {r.status === "Planned" && (
              <button
                onClick={() =>
                  void run(() =>
                    api(`/api/v1/records/shipment/${r.id}/transition`, {
                      version: r.version,
                      status: "Shipped",
                    }),
                  )
                }
              >
                Confirm shipped
              </button>
            )}
            {r.status === "Shipped" && (
              <button
                onClick={() => {
                  setSelected({ ...r, kind: "delivered" });
                  setForm({
                    actualDate: new Date().toISOString().slice(0, 10),
                  });
                }}
              >
                Confirm delivery date
              </button>
            )}
          </article>
        ))}
      </section>
      {selected && (
        <div className="modal-backdrop">
          <section
            className="modal wide"
            role="dialog"
            aria-modal="true"
            aria-label="Supplier response"
          >
            <header>
              <h2>
                {selected.kind === "quote"
                  ? "Respond to RFQ"
                  : selected.kind === "promise"
                    ? "Confirm supplier promises"
                    : selected.kind === "shipment"
                      ? "Record shipment"
                      : "Confirm delivery"}
              </h2>
              <button onClick={() => setSelected(null)}>Close response</button>
            </header>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void run(async () => {
                  if (selected.kind === "quote")
                    await api("/api/v1/records/quote", {
                      ...form,
                      projectId: selected.projectId,
                      partId: selected.partId,
                      supplierId: ws.actor.supplierId,
                      unit: part(selected.partId)?.unit,
                      rfqId: selected.id,
                      requestDate: selected.createdAt.slice(0, 10),
                    });
                  else if (selected.kind === "promise")
                    await api("/api/v1/operations/vendorPromise", {
                      id: selected.id,
                      version: selected.version,
                      lines: form.lines,
                    });
                  else if (selected.kind === "shipment")
                    await api("/api/v1/records/shipment", {
                      projectId: selected.projectId,
                      poId: selected.id,
                      reference: form.reference,
                      carrier: form.carrier,
                      tracking: form.tracking,
                      expectedDate: form.expectedDate,
                      lines: [{ lineId: form.lineId, quantity: form.quantity }],
                    });
                  else
                    await api(
                      `/api/v1/records/shipment/${selected.id}/transition`,
                      {
                        version: selected.version,
                        status: "Delivered",
                        actualDate: form.actualDate,
                      },
                    );
                  setSelected(null);
                });
              }}
            >
              <div className="form-grid">
                {selected.kind === "quote" && (
                  <>
                    {[
                      "quantity",
                      "unitCost",
                      "freight",
                      "tax",
                      "leadMin",
                      "leadMax",
                    ].map((k) => (
                      <label key={k}>
                        {
                          (
                            {
                              quantity: "Quoted quantity",
                              unitCost: "Unit price",
                              freight: "Freight",
                              tax: "Tax",
                              leadMin: "Minimum lead days ARO",
                              leadMax: "Maximum lead days ARO",
                            } as R
                          )[k]
                        }
                        <input
                          required
                          type="number"
                          min={k === "quantity" ? 0.000001 : 0}
                          step="any"
                          value={form[k]}
                          onChange={(e) => field(k, Number(e.target.value))}
                        />
                      </label>
                    ))}
                    <label>
                      Currency
                      <select
                        value={form.currency}
                        onChange={(e) => field("currency", e.target.value)}
                      >
                        {["USD", "CAD", "EUR", "GBP"].map((c) => (
                          <option key={c}>{c}</option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Valid through
                      <input
                        type="date"
                        value={form.validUntil}
                        onChange={(e) => field("validUntil", e.target.value)}
                      />
                    </label>
                  </>
                )}
                {selected.kind === "promise" &&
                  form.lines.map((l: R, i: number) => (
                    <React.Fragment key={l.id}>
                      <label>
                        {
                          part(
                            selected.lines.find((x: R) => x.id === l.id)
                              ?.partId,
                          )?.partNumber
                        }{" "}
                        · acknowledged order date
                        <input
                          type="date"
                          value={l.ackDate}
                          onChange={(e) =>
                            field(
                              "lines",
                              form.lines.map((x: R, j: number) =>
                                i === j ? { ...x, ackDate: e.target.value } : x,
                              ),
                            )
                          }
                        />
                      </label>
                      <label>
                        Confirmed arrival (blank = unconfirmed)
                        <input
                          type="date"
                          value={l.confirmedETA}
                          onChange={(e) =>
                            field(
                              "lines",
                              form.lines.map((x: R, j: number) =>
                                i === j
                                  ? { ...x, confirmedETA: e.target.value }
                                  : x,
                              ),
                            )
                          }
                        />
                      </label>
                    </React.Fragment>
                  ))}
                {selected.kind === "shipment" && (
                  <>
                    {["reference", "carrier", "tracking"].map((k) => (
                      <label key={k}>
                        {k}
                        <input
                          required={k === "reference"}
                          value={form[k]}
                          onChange={(e) => field(k, e.target.value)}
                        />
                      </label>
                    ))}
                    <label>
                      Expected arrival
                      <input
                        type="date"
                        value={form.expectedDate}
                        onChange={(e) => field("expectedDate", e.target.value)}
                      />
                    </label>
                    <label>
                      PO line
                      <select
                        value={form.lineId}
                        onChange={(e) => field("lineId", e.target.value)}
                      >
                        {selected.lines.map((l: R) => (
                          <option key={l.id} value={l.id}>
                            {part(l.partId)?.partNumber}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Shipment quantity
                      <input
                        required
                        type="number"
                        min="0.000001"
                        step="any"
                        value={form.quantity}
                        onChange={(e) =>
                          field("quantity", Number(e.target.value))
                        }
                      />
                    </label>
                    <p>
                      Create additional shipments for other lines or split
                      deliveries. Delivery confirmation does not receive stock
                      into inventory.
                    </p>
                  </>
                )}
                {selected.kind === "delivered" && (
                  <label>
                    Actual delivery date
                    <input
                      required
                      type="date"
                      value={form.actualDate}
                      onChange={(e) => field("actualDate", e.target.value)}
                    />
                  </label>
                )}
              </div>
              <button className="primary" disabled={busy}>
                Save supplier response
              </button>
            </form>
          </section>
        </div>
      )}
      {evidence && (
        <section className="panel vendor-record">
          <div className="panel-head">
            <h2>Shared documents</h2>
            <button onClick={() => setEvidence(null)}>Close documents</button>
          </div>
          {files.map((f: R) => (
            <p key={f.id}>
              <a href={`${BASE}/api/v1/attachments/${f.id}`}>{f.name}</a>
            </p>
          ))}
          {!files.length && <p>No supplier-visible files.</p>}
          {evidence.kind !== "po" && (
            <label>
              Add PDF or photo
              <input
                type="file"
                accept=".pdf,.png,.jpg,.jpeg"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  void run(async () => {
                    if (file.size > 5000000)
                      throw new Error("Files must be at most 5 MB");
                    const bytes = new Uint8Array(await file.arrayBuffer());
                    let binary = "";
                    for (let i = 0; i < bytes.length; i += 32768)
                      binary += String.fromCharCode(
                        ...bytes.subarray(i, i + 32768),
                      );
                    await api("/api/v1/attachments", {
                      kind: evidence.kind,
                      entity: evidence.id,
                      name: file.name,
                      mime: file.type,
                      base64: btoa(binary),
                    });
                    await showFiles(evidence.kind, evidence.id);
                  });
                }}
              />
            </label>
          )}
        </section>
      )}
    </main>
  );
}
