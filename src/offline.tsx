import React, { useEffect, useState } from "react";
import {
  readVault,
  writeVault,
  seal,
  unseal,
  eraseVault,
  fieldPackages,
} from "./offline-vault";
type R = Record<string, any>;
const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
async function request(path: string, body?: any, key?: string) {
  const response = await fetch(BASE + path, {
    method: body === undefined ? "GET" : "POST",
    headers:
      body === undefined
        ? {}
        : {
            "Content-Type": "application/json",
            "Idempotency-Key": key || crypto.randomUUID(),
          },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const value = await response.json();
  if (!response.ok) throw new Error(value.error || "Request failed");
  return value;
}
export function OfflineKit() {
  const [exists, setExists] = useState<boolean | null>(null),
    [pass, setPass] = useState(""),
    [vault, setVault] = useState<R | null>(null),
    [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false),
    [selected, setSelected] = useState(""),
    [form, setForm] = useState<R>({
      mode: "fieldEntry",
      regular: 8,
      overtime: 0,
      quantity: 0,
      notes: "",
      status: "Present",
    }),
    [files, setFiles] = useState<R[]>([]),
    [rebase, setRebase] = useState<R | null>(null),
    [editing, setEditing] = useState<R | null>(null);
  useEffect(() => {
    void readVault()
      .then((v) => setExists(!!v))
      .catch((e) => setError(e.message));
  }, []);
  const perform = async (fn: () => Promise<void>) => {
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
  const persist = async (next: R) => {
    await writeVault(await seal(next, pass));
    setVault(next);
  };
  const checkAccount = (ws: R) => {
    if (
      ws.actor.id !== vault?.account.id ||
      ws.actor.org !== vault?.account.org
    )
      throw new Error(
        "Sign in online as the same account before syncing this encrypted kit",
      );
  };
  const current = vault?.packages.find((p: R) => p.assignmentId === selected);
  const update = (k: string, v: any) => setForm({ ...form, [k]: v });
  async function prepareShell() {
    if (!("serviceWorker" in navigator))
      throw new Error("This browser does not support offline app installation");
    if (import.meta.env.DEV)
      throw new Error(
        "Offline installation requires the production build (npm run build, then NODE_ENV=production npm start)",
      );
    const registration = await navigator.serviceWorker.register(
      import.meta.env.BASE_URL + "fieldops-sw.js",
      { scope: import.meta.env.BASE_URL },
    );
    await registration.update();
    await navigator.serviceWorker.ready;
  }
  return (
    <main className="offline-kit">
      <header className="page-heading">
        <div>
          <span className="eyebrow">CAS FIELDOPS · OFFLINE FIELD KIT</span>
          <h1>Keep field drafts with you.</h1>
          <p>
            Opt in on this device. Work packages, drafts and photos are
            encrypted with your offline passphrase. Keep it safe: the server
            cannot recover it.
          </p>
        </div>
        <a className="button" href="#">
          Back to online workspace
        </a>
      </header>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {message && <p role="status">{message}</p>}
      {!vault && (
        <section className="panel vendor-record">
          <h2>
            {exists ? "Unlock this device" : "Prepare this device online"}
          </h2>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void perform(async () => {
                if (exists) {
                  const encrypted = await readVault();
                  if (!encrypted) throw new Error("No vault on this device");
                  setVault(await unseal(encrypted, pass));
                } else {
                  const ws = await request("/api/v1/workspace");
                  if (ws.readOnly)
                    throw new Error(
                      "Use your self-hosted installation for offline work",
                    );
                  const kit = fieldPackages(ws);
                  await prepareShell();
                  await persist({ ...kit, drafts: [] });
                  setExists(true);
                  setMessage(
                    "Encrypted kit saved. Open this same URL with #offline when disconnected.",
                  );
                }
              });
            }}
          >
            <label>
              Offline passphrase (12+ characters)
              <input
                type="password"
                minLength={12}
                required
                autoComplete="off"
                value={pass}
                onChange={(e) => setPass(e.target.value)}
              />
            </label>
            <button className="primary" disabled={busy || exists === null}>
              {exists
                ? "Unlock encrypted kit"
                : "Cache assigned work & encrypt kit"}
            </button>
          </form>
          <p>
            Only the app shell is stored in the browser cache. API responses,
            supplier pricing and payroll are excluded. Use Lock kit before
            sharing this device; encrypted drafts remain until you erase the
            kit.
          </p>
        </section>
      )}
      {vault && (
        <>
          <section className="panel vendor-record">
            <div className="panel-head">
              <div>
                <h2>{vault.account.name} · assigned work</h2>
                <p>
                  Cached {vault.cachedAt}. {vault.packages.length} work packages
                  ·{" "}
                  {
                    vault.drafts.filter(
                      (d: R) => !["Synced", "Archived"].includes(d.status),
                    ).length
                  }{" "}
                  unsynced drafts.
                </p>
              </div>
              <div className="actions">
                <button
                  disabled={busy}
                  onClick={() => {
                    setVault(null);
                    setPass("");
                    setFiles([]);
                    setRebase(null);
                  }}
                >
                  Lock kit
                </button>
                <button
                  disabled={busy}
                  onClick={() =>
                    void perform(async () => {
                      const ws = await request("/api/v1/workspace");
                      checkAccount(ws);
                      await persist({ ...vault, ...fieldPackages(ws) });
                      await prepareShell();
                      setMessage(
                        "Work packages refreshed. Existing drafts retain their original versions until explicitly reviewed.",
                      );
                    })
                  }
                >
                  Refresh assigned work
                </button>
                <button
                  className="primary"
                  disabled={
                    busy ||
                    !vault.drafts.some(
                      (d: R) => !["Synced", "Archived"].includes(d.status),
                    )
                  }
                  onClick={() =>
                    void perform(async () => {
                      const ws = await request("/api/v1/workspace");
                      checkAccount(ws);
                      let next = {
                        ...vault,
                        drafts: vault.drafts.map((d: R) => ({
                          ...d,
                          files: d.files.map((f: R) => ({ ...f })),
                        })),
                      };
                      for (const d of next.drafts) {
                        if (["Synced", "Archived"].includes(d.status)) continue;
                        try {
                          if (!d.receipt) {
                            d.receipt = await request(
                              "/api/v1/operations/fieldSync",
                              {
                                context: d.context,
                                mode: d.mode,
                                payload: d.payload,
                              },
                              d.key,
                            );
                            await persist({ ...next });
                          }
                          for (const file of d.files) {
                            if (file.receipt || file.skipped) continue;
                            const kind =
                                d.mode === "fieldEntry" ? "time" : d.mode,
                              entity =
                                d.mode === "fieldEntry"
                                  ? d.receipt.time.id
                                  : d.receipt.id;
                            if (kind === "checkin")
                              throw new Error(
                                "Check-in evidence is not supported; attach photos to time or production",
                              );
                            file.receipt = await request(
                              "/api/v1/attachments",
                              {
                                kind,
                                entity,
                                name: file.name,
                                mime: file.mime,
                                base64: file.base64,
                              },
                              file.key,
                            );
                            await persist({ ...next });
                          }
                          d.status = "Synced";
                          d.error = "";
                          d.syncedAt = new Date().toISOString();
                        } catch (e: any) {
                          d.status = d.receipt
                            ? "Evidence pending"
                            : "Needs review";
                          d.error = e.message;
                        }
                        await persist({ ...next });
                      }
                      setMessage(
                        "Sync finished. Review any conflicts below; completed records remain subject to normal approval.",
                      );
                    })
                  }
                >
                  Sync reviewed drafts
                </button>
              </div>
            </div>
            <label>
              Work package
              <select
                value={selected}
                onChange={(e) => {
                  setSelected(e.target.value);
                  const p = vault.packages.find(
                    (p: R) => p.assignmentId === e.target.value,
                  );
                  if (p) setForm({ ...form, regular: p.hours });
                }}
              >
                <option value="">Choose an assignment</option>
                {vault.packages.map((p: R) => (
                  <option key={p.assignmentId} value={p.assignmentId}>
                    {p.date} · {p.worker} · {p.project} · {p.task}
                  </option>
                ))}
              </select>
            </label>
            {current && (
              <>
                <h3>{current.task}</h3>
                <p>
                  {current.instructions || "No instructions supplied"} ·{" "}
                  {current.permits || "No permit notes"}
                </p>
                <p>
                  Planned production: {current.plannedQuantity ?? "Unallocated"}{" "}
                  {current.unit} · task target {current.target} {current.unit}
                </p>
                {current.materials.map((m: R, i: number) => (
                  <p key={i}>
                    {m.part}: {m.coverage}/{m.quantity} {m.unit} covered ·{" "}
                    {m.risk} (cached)
                  </p>
                ))}
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    void perform(async () => {
                      if (
                        vault.drafts.filter(
                          (d: R) => !["Synced", "Archived"].includes(d.status),
                        ).length >= 100
                      )
                        throw new Error(
                          "Sync existing drafts before adding more than 100",
                        );
                      const { projectId, taskId, workerId, date, start, unit } =
                        current;
                      const payload = {
                        projectId,
                        taskId,
                        workerId,
                        date,
                        start,
                        unit,
                        regular: Number(form.regular),
                        overtime: Number(form.overtime),
                        quantity: Number(form.quantity),
                        notes: form.notes,
                        status: form.status,
                      };
                      if (
                        form.mode === "fieldEntry" &&
                        (payload.regular + payload.overtime <= 0 ||
                          payload.start + payload.regular + payload.overtime >
                            24)
                      )
                        throw new Error(
                          "Enter valid hours within this work day",
                        );
                      if (form.mode === "production" && payload.quantity <= 0)
                        throw new Error("Enter a positive installed quantity");
                      const draft = {
                        id: crypto.randomUUID(),
                        key: crypto.randomUUID(),
                        mode: form.mode,
                        context: {
                          assignmentId: current.assignmentId,
                          assignmentVersion: current.assignmentVersion,
                          taskVersion: current.taskVersion,
                        },
                        package: current,
                        payload,
                        files: form.mode === "checkin" ? [] : files,
                        status: "Queued",
                        createdAt: new Date().toISOString(),
                        rebases: [],
                      };
                      await persist({
                        ...vault,
                        drafts: [...vault.drafts, draft],
                      });
                      setFiles([]);
                      setForm({ ...form, quantity: 0, notes: "" });
                      setMessage(
                        "Draft encrypted and saved on this device. It has not been submitted to the server.",
                      );
                    });
                  }}
                >
                  <div className="form-grid">
                    <label>
                      Entry type
                      <select
                        value={form.mode}
                        onChange={(e) => update("mode", e.target.value)}
                      >
                        <option value="fieldEntry">
                          Time and installed quantity
                        </option>
                        <option value="production">
                          Installed quantity only
                        </option>
                        <option value="checkin">Daily check-in</option>
                      </select>
                    </label>
                    {form.mode === "fieldEntry" &&
                      ["regular", "overtime"].map((k) => (
                        <label key={k}>
                          {k} hours
                          <input
                            required
                            type="number"
                            min="0"
                            max="16"
                            step="0.25"
                            value={form[k]}
                            onChange={(e) => update(k, Number(e.target.value))}
                          />
                        </label>
                      ))}
                    {form.mode !== "checkin" ? (
                      <label>
                        Installed quantity ({current.unit})
                        <input
                          required
                          type="number"
                          min="0"
                          step="any"
                          value={form.quantity}
                          onChange={(e) =>
                            update("quantity", Number(e.target.value))
                          }
                        />
                      </label>
                    ) : (
                      <label>
                        Check-in status
                        <select
                          value={form.status}
                          onChange={(e) => update("status", e.target.value)}
                        >
                          {["Present", "Absent", "Delayed"].map((s) => (
                            <option key={s}>{s}</option>
                          ))}
                        </select>
                      </label>
                    )}
                    <label>
                      Notes
                      <textarea
                        value={form.notes}
                        onChange={(e) => update("notes", e.target.value)}
                      />
                    </label>
                    {form.mode !== "checkin" && (
                      <label>
                        Evidence photos or PDFs (5 MB each)
                        <input
                          type="file"
                          multiple
                          accept=".png,.jpg,.jpeg,.pdf"
                          onChange={(e) => {
                            const chosen = Array.from(e.target.files || []);
                            void perform(async () => {
                              const added: R[] = [];
                              for (const file of chosen) {
                                if (file.size > 5000000)
                                  throw new Error(
                                    "Each file must be at most 5 MB",
                                  );
                                const bytes = new Uint8Array(
                                  await file.arrayBuffer(),
                                );
                                let binary = "";
                                for (let i = 0; i < bytes.length; i += 32768)
                                  binary += String.fromCharCode(
                                    ...bytes.subarray(i, i + 32768),
                                  );
                                added.push({
                                  name: file.name,
                                  mime: file.type,
                                  base64: btoa(binary),
                                  key: crypto.randomUUID(),
                                });
                              }
                              setFiles([...files, ...added]);
                            });
                          }}
                        />
                      </label>
                    )}
                  </div>
                  {files.map((f: R, i: number) => (
                    <p key={f.key}>
                      {f.name}{" "}
                      <button
                        type="button"
                        onClick={() =>
                          setFiles(files.filter((_, j) => j !== i))
                        }
                      >
                        Remove file
                      </button>
                    </p>
                  ))}
                  <button className="primary" disabled={busy}>
                    Save encrypted draft
                  </button>
                </form>
              </>
            )}
          </section>
          <section className="panel vendor-record">
            <h2>Draft queue and sync receipts</h2>
            {vault.drafts.map((d: R) => (
              <article className="vendor-record" key={d.id}>
                <strong>
                  {d.package.date} · {d.package.task} · {d.mode}
                </strong>
                <p>
                  {d.payload.regular || 0} regular hours ·{" "}
                  {d.payload.quantity || 0} {d.payload.unit} installed ·{" "}
                  {d.files.length} files · {d.status}
                </p>
                {d.error && <p className="error">{d.error}</p>}
                {d.receipt && (
                  <p>Server receipt: {d.receipt.time?.id || d.receipt.id}</p>
                )}
                {!d.receipt && (
                  <>
                    <button
                      disabled={busy}
                      onClick={() =>
                        setEditing({ ...d, payload: { ...d.payload } })
                      }
                    >
                      Correct draft
                    </button>
                    <button
                      disabled={busy}
                      onClick={() =>
                        void perform(() =>
                          persist({
                            ...vault,
                            drafts: vault.drafts.map((r: R) =>
                              r.id === d.id
                                ? {
                                    ...r,
                                    status:
                                      r.status === "Archived"
                                        ? "Queued"
                                        : "Archived",
                                  }
                                : r,
                            ),
                          }),
                        )
                      }
                    >
                      {d.status === "Archived"
                        ? "Restore draft"
                        : "Archive draft"}
                    </button>
                  </>
                )}
                {d.status === "Evidence pending" && (
                  <button
                    disabled={busy}
                    onClick={() =>
                      void perform(() =>
                        persist({
                          ...vault,
                          drafts: vault.drafts.map((r: R) =>
                            r.id === d.id
                              ? {
                                  ...r,
                                  files: r.files.map((f: R) =>
                                    f.receipt ? f : { ...f, skipped: true },
                                  ),
                                  status: "Evidence pending",
                                  error:
                                    "Unsent evidence explicitly skipped; retry to finish",
                                }
                              : r,
                          ),
                        }),
                      )
                    }
                  >
                    Skip unsent evidence
                  </button>
                )}
                {!d.receipt && (
                  <button
                    disabled={busy}
                    onClick={() =>
                      void perform(async () => {
                        const ws = await request("/api/v1/workspace");
                        checkAccount(ws);
                        const updated = fieldPackages(ws).packages.find(
                          (p: R) => p.assignmentId === d.context.assignmentId,
                        );
                        if (!updated)
                          throw new Error(
                            "Assignment was cancelled or access removed. Keep this draft for review; it cannot be synced to another assignment automatically.",
                          );
                        setRebase({ draft: d, updated });
                      })
                    }
                  >
                    Review current work package
                  </button>
                )}
              </article>
            ))}
            {!vault.drafts.length && <p>No local drafts.</p>}
          </section>
        </>
      )}
      {rebase && (
        <section className="panel vendor-record">
          <h2>Review changed assignment before retry</h2>
          <p>
            Task: {rebase.draft.package.task} → {rebase.updated.task}
          </p>
          <p>
            Date: {rebase.draft.package.date} → {rebase.updated.date}. Planned
            hours: {rebase.draft.package.hours} → {rebase.updated.hours}. Task
            version: {rebase.draft.context.taskVersion} →{" "}
            {rebase.updated.taskVersion}.
          </p>
          <p>{rebase.updated.instructions}</p>
          <p>
            Your actual hours, installed quantity and notes will remain. A
            changed assignment date or worker requires a new draft; this action
            cannot move recorded work.
          </p>
          <button
            disabled={busy}
            onClick={() =>
              void perform(async () => {
                const d = rebase.draft,
                  p = rebase.updated;
                if (
                  ["date", "workerId", "taskId", "projectId", "unit"].some(
                    (k) => p[k] !== d.package[k],
                  )
                )
                  throw new Error(
                    "Work identity changed; create a new reviewed draft for the appropriate assignment",
                  );
                await persist({
                  ...vault,
                  drafts: vault!.drafts.map((r: R) =>
                    r.id === d.id
                      ? {
                          ...r,
                          key: crypto.randomUUID(),
                          context: {
                            assignmentId: p.assignmentId,
                            assignmentVersion: p.assignmentVersion,
                            taskVersion: p.taskVersion,
                          },
                          package: p,
                          status: "Queued",
                          error: "",
                          rebases: [
                            ...r.rebases,
                            {
                              at: new Date().toISOString(),
                              from: r.context,
                              to: {
                                assignmentVersion: p.assignmentVersion,
                                taskVersion: p.taskVersion,
                              },
                            },
                          ],
                        }
                      : r,
                  ),
                });
                setRebase(null);
                setMessage(
                  "Updated package explicitly accepted. Sync when ready.",
                );
              })
            }
          >
            Accept updated package & retry later
          </button>
          <button onClick={() => setRebase(null)}>Keep original draft</button>
        </section>
      )}
      {editing && (
        <section className="panel vendor-record">
          <h2>Correct unsynced draft</h2>
          <p>
            The original work-package version remains attached. Corrections get
            a new retry key.
          </p>
          <div className="form-grid">
            {["regular", "overtime", "quantity"].map((k) => (
              <label key={k}>
                {k}
                <input
                  type="number"
                  min="0"
                  step="any"
                  value={editing.payload[k] || 0}
                  onChange={(e) =>
                    setEditing({
                      ...editing,
                      payload: {
                        ...editing.payload,
                        [k]: Number(e.target.value),
                      },
                    })
                  }
                />
              </label>
            ))}
            <label>
              Notes
              <textarea
                value={editing.payload.notes}
                onChange={(e) =>
                  setEditing({
                    ...editing,
                    payload: { ...editing.payload, notes: e.target.value },
                  })
                }
              />
            </label>
          </div>
          <button
            disabled={busy}
            onClick={() =>
              void perform(async () => {
                await persist({
                  ...vault,
                  drafts: vault!.drafts.map((r: R) =>
                    r.id === editing.id
                      ? {
                          ...editing,
                          key: crypto.randomUUID(),
                          status: "Queued",
                          error: "",
                        }
                      : r,
                  ),
                });
                setEditing(null);
              })
            }
          >
            Save corrected draft
          </button>
          <button onClick={() => setEditing(null)}>Cancel correction</button>
        </section>
      )}
      <section className="panel vendor-record">
        <h2>Device privacy</h2>
        <p>
          Use a trusted device. Lock or erase this kit when handing it to
          someone else. Erasing removes all encrypted work packages, unsynced
          drafts and cached app files from this browser.
        </p>
        <button
          disabled={busy || exists === null}
          onClick={() => {
            if (
              !window.confirm(
                "Erase this device’s encrypted kit and unsynced drafts? Server records are retained.",
              )
            )
              return;
            void perform(async () => {
              await eraseVault();
              for (const key of await caches.keys())
                if (
                  key.startsWith("fieldops-shell-") &&
                  key.endsWith(import.meta.env.BASE_URL)
                )
                  await caches.delete(key);
              for (const r of await navigator.serviceWorker.getRegistrations())
                if (
                  r.scope ===
                  new URL(import.meta.env.BASE_URL, location.origin).href
                )
                  await r.unregister();
              setVault(null);
              setPass("");
              setFiles([]);
              setExists(false);
              setMessage("Offline data erased from this browser.");
            });
          }}
        >
          Erase offline kit from this device
        </button>
      </section>
    </main>
  );
}
