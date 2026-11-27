import React, { useState } from "react";
type R = Record<string, any>;
const utc = (d: string) => Date.parse(d + "T00:00:00Z");
const date = (n: number) => new Date(n).toISOString().slice(0, 10);
export function ScheduleGantt({
  ws,
  project,
  open,
}: {
  ws: R;
  project: string;
  open: (kind: string, defaults?: R) => void;
}) {
  const [section, setSection] = useState(""),
    [selected, setSelected] = useState(""),
    [branch, setBranch] = useState("");
  const tasks = ws.data.task.filter(
    (t: R) =>
      (!project || t.projectId === project) &&
      (!section || t.section === section),
  );
  const revisions = (ws.data.scheduleRevision || []).filter(
    (r: R) => !project || r.projectId === project,
  );
  const proposal = revisions.find((r: R) => r.id === branch);
  const values = tasks
    .flatMap((t: R) => [
      t.baselineStart,
      t.baselineEnd,
      t.forecastStart,
      t.forecastEnd,
      ...(proposal?.dates || [])
        .filter((d: R) => d.taskId === t.id)
        .flatMap((d: R) => [d.start, d.finish]),
    ])
    .filter(Boolean)
    .map(utc);
  const start = values.length ? Math.min(...values) : Date.now(),
    end = values.length ? Math.max(...values) : start + 86400000 * 30,
    days = Math.max(7, Math.round((end - start) / 86400000) + 1);
  const pos = (d: string) => ((utc(d) - start) / 86400000 / days) * 100;
  const bar = (s: string, e: string, cls: string, label: string) =>
    s && e ? (
      <div
        className={"gantt-bar " + cls}
        style={{
          left: pos(s) + "%",
          width:
            Math.max(0.5, (((utc(e) - utc(s)) / 86400000 + 1) / days) * 100) +
            "%",
        }}
        title={`${label}: ${s} – ${e}`}
        aria-label={`${label}: ${s} – ${e}`}
      />
    ) : null;
  const picked = tasks.find((t: R) => t.id === selected),
    ready = ws.readiness.find((r: R) => r.taskId === selected),
    forecast = ws.forecast.find((r: R) => r.taskId === selected);
  const manager = ["admin", "pm"].includes(ws.actor.role) && !ws.readOnly;
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">PROJECT SCHEDULE</span>
          <h1>One schedule. Shared progress.</h1>
          <p>
            Baseline, approved forecast and review branches use the same tasks
            as materials, crew assignments and production.
          </p>
        </div>
        {manager && project && (
          <button
            className="primary"
            onClick={() =>
              open("scheduleRevision", {
                projectId: project,
                dates: tasks
                  .filter((t: R) => t.baselineStart && t.baselineEnd)
                  .map((t: R) => ({
                    taskId: t.id,
                    start: t.forecastStart || t.baselineStart,
                    finish: t.forecastEnd || t.baselineEnd,
                  })),
              })
            }
          >
            Propose schedule revision
          </button>
        )}
      </div>
      <div className="toolbar">
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
            ].map((v: any) => (
              <option key={v}>{v}</option>
            ))}
          </select>
        </label>
        <label>
          Review branch
          <select value={branch} onChange={(e) => setBranch(e.target.value)}>
            <option value="">Approved schedule only</option>
            {revisions.map((r: R) => (
              <option key={r.id} value={r.id}>
                {r.name} · {r.status} · {r.mode}
              </option>
            ))}
          </select>
        </label>
        <p>
          Gray: baseline · green: approved forecast · dashed: selected revision
        </p>
      </div>
      <section className="panel">
        <div className="table-wrap">
          <div
            className="gantt"
            style={{ minWidth: Math.max(850, Math.min(days * 16, 2400)) }}
          >
            <div className="gantt-row gantt-header">
              <strong>Task · progress · readiness</strong>
              <div className="gantt-track">
                {Array.from({ length: Math.min(10, days) }, (_, i) => {
                  const offset = Math.floor((i * days) / Math.min(10, days));
                  return (
                    <span
                      className="gantt-tick"
                      style={{ left: (offset / days) * 100 + "%" }}
                      key={i}
                    >
                      {date(start + offset * 86400000)}
                    </span>
                  );
                })}
              </div>
            </div>
            {tasks.map((t: R) => {
              const r = ws.readiness.find((r: R) => r.taskId === t.id),
                f = ws.forecast.find((f: R) => f.taskId === t.id),
                p = proposal?.dates.find((d: R) => d.taskId === t.id);
              return (
                <div className="gantt-row" key={t.id}>
                  <button
                    className="gantt-task"
                    onClick={() => setSelected(t.id)}
                  >
                    <strong>{t.name}</strong>
                    <small>
                      {t.section} ·{" "}
                      {f?.progress == null
                        ? "No approved quantity target"
                        : Math.round(f.progress) + "%"}{" "}
                      · {r?.status || "Unconfirmed"}
                    </small>
                  </button>
                  <div className="gantt-track">
                    {bar(
                      t.baselineStart,
                      t.baselineEnd,
                      "baseline",
                      "Baseline",
                    )}
                    {bar(
                      t.forecastStart,
                      t.forecastEnd,
                      "forecast",
                      "Approved forecast",
                    )}
                    {p && bar(p.start, p.finish, "proposal", "Review branch")}
                    {!t.baselineStart && !t.forecastStart && (
                      <small>Unscheduled</small>
                    )}
                    {r && r.status !== "Ready" && (
                      <button
                        className="gantt-warning"
                        onClick={() => setSelected(t.id)}
                        title={r.reason}
                      >
                        Material / release risk
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
        {!tasks.length && <p className="empty-note">No tasks in this scope.</p>}
      </section>
      {picked && (
        <section className="panel">
          <div className="panel-head">
            <h2>{picked.name}</h2>
            <button onClick={() => setSelected("")}>Close task</button>
          </div>
          <div className="schedule-details">
            <div>
              <h3>Shared progress</h3>
              <p>
                {forecast?.installed ?? "—"} / {picked.target} {picked.unit}{" "}
                approved · {forecast?.actual ?? "—"} actual hours
              </p>
              <p>
                Earned {forecast?.earned ?? "—"}h · remaining{" "}
                {forecast?.remaining ?? "Unapproved"}h
              </p>
              <p>
                Dependencies:{" "}
                {(picked.dependencies || [])
                  .map(
                    (id: string) =>
                      ws.data.task.find((t: R) => t.id === id)?.name || id,
                  )
                  .join(", ") || "None"}
              </p>
              <p>
                Original baseline:{" "}
                {picked.originalBaseline?.start ||
                  picked.baselineStart ||
                  "Unscheduled"}{" "}
                –{" "}
                {picked.originalBaseline?.finish ||
                  picked.baselineEnd ||
                  "Unscheduled"}
              </p>
            </div>
            <div>
              <h3>Linked unresolved constraints</h3>
              <p>{ready?.reason}</p>
              {(ready?.lines || [])
                .filter((l: R) => l.shortage > 0)
                .map((l: R) => (
                  <p key={l.id}>
                    {l.partNumber}: {l.shortage} {l.unit} short · {l.risk} ·
                    need by {l.needBy || "unscheduled"}
                  </p>
                ))}
              {(ready?.holds || []).map((h: R) => (
                <p key={h.id}>
                  {h.status} hold: {h.reason} · proposed start{" "}
                  {h.proposedStart || "unconfirmed"}
                </p>
              ))}
              {manager && (
                <button
                  onClick={() =>
                    open("hold", {
                      projectId: picked.projectId,
                      taskId: picked.id,
                      reason: (ready?.lines || [])
                        .filter((l: R) => l.shortage > 0)
                        .map(
                          (l: R) =>
                            l.partNumber +
                            ": " +
                            l.shortage +
                            " " +
                            l.unit +
                            " short",
                        )
                        .join("; "),
                    })
                  }
                >
                  Propose linked hold
                </button>
              )}
            </div>
          </div>
          <p>
            Shortages remain visible until stock is allocated. Proposed holds
            and schedule branches require manager review; they do not move
            approved dates automatically.
          </p>
        </section>
      )}
      <section className="panel">
        <div className="panel-head">
          <h2>Schedule revision register</h2>
        </div>
        {revisions.map((r: R) => (
          <p key={r.id}>
            <strong>{r.name}</strong> · {r.status} · {r.mode} · {r.reason}
            <small>
              {r.dates.length} task dates · created {r.createdAt}
            </small>
          </p>
        ))}
        {!revisions.length && (
          <p className="empty-note">No schedule revisions yet.</p>
        )}
      </section>
    </>
  );
}
