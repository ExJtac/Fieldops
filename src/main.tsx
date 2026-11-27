import React, { useEffect, useState, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import {
  LayoutDashboard,
  Package,
  ShoppingCart,
  Truck,
  Warehouse,
  Users,
  CalendarDays,
  Clock,
  ClipboardCheck,
  ChartNoAxesCombined,
  FileChartColumn,
  Settings,
  Plus,
  Search,
  ArrowUpRight,
  ArrowRight,
  Check,
  ChevronDown,
  X,
  Download,
  Upload,
  LogOut,
  ShieldCheck,
  AlertTriangle,
  History,
  CheckCircle2,
  Menu,
  FolderKanban,
  RefreshCw,
} from "lucide-react";
import { WorkspaceSwitcher } from "./tenants";
import { OfflineKit } from "./offline";
import { VendorPortal } from "./vendor";
import { ScheduleGantt } from "./gantt";
import { MaterialWorkspace, QuoteComparison } from "./material-workspace";
import { Workflows, ProcurementBoard } from "./workflows";
import { forms, type Field } from "./forms";
import "@fontsource/dm-sans/400.css";
import "@fontsource/dm-sans/500.css";
import "@fontsource/dm-sans/600.css";
import "@fontsource/manrope/500.css";
import "@fontsource/manrope/700.css";
import "./style.css";
const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
type Row = Record<string, any>;
type Modal = { kind: string; record?: Row; defaults?: Row };
const today = () =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "America/Denver" }).format(
    new Date(),
  );
const number = (v: any) =>
  v == null
    ? "—"
    : Number(v).toLocaleString(undefined, { maximumFractionDigits: 2 });
const money = (v: number, currency = "USD") =>
  new Intl.NumberFormat("en-US", { style: "currency", currency }).format(v);
const addDays = (d: string, n: number) =>
  new Date(Date.parse(d + "T00:00:00Z") + n * 86400000)
    .toISOString()
    .slice(0, 10);
const monday = (d: string) =>
  addDays(d, -((new Date(d + "T00:00:00Z").getUTCDay() + 6) % 7));
const nav = [
  ["overview", "Overview", LayoutDashboard],
  ["materials", "Materials", Package],
  ["orders", "Procurement", ShoppingCart],
  ["deliveries", "Deliveries", Truck],
  ["inventory", "Inventory", Warehouse],
  ["crews", "People & crews", Users],
  ["assignments", "Resource board", CalendarDays],
  ["schedule", "Project Gantt", CalendarDays],
  ["time", "Timesheets", Clock],
  ["production", "Daily production", ClipboardCheck],
  ["forecasts", "Forecasts", ChartNoAxesCombined],
  ["reports", "Reports & audit", FileChartColumn],
  ["workflows", "Operations center", FolderKanban],
  ["settings", "Workspace", Settings],
] as const;
async function api(path: string, body?: any, method = "POST") {
  const r = await fetch(BASE + path, {
    method: body === undefined ? "GET" : method,
    headers:
      body === undefined
        ? {}
        : {
            "Content-Type": "application/json",
            "Idempotency-Key": crypto.randomUUID(),
          },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await r.json();
  if (!r.ok) throw new Error(data.error || "Request failed");
  return data;
}
function Badge({ children }: { children: ReactNode }) {
  const s = String(children);
  return (
    <span
      className={
        "badge " +
        (/Ready|Approved|Locked|Issued|Recorded/.test(s)
          ? "green"
          : /Blocked|Rejected|Late|Cancelled|expired/.test(s)
            ? "red"
            : /Partial|Submitted|Unconfirmed|Proposed|Draft|Awaiting/.test(s)
              ? "amber"
              : "neutral")
      }
    >
      {children}
    </span>
  );
}
function Empty({
  title = "Nothing here yet",
  detail = "Add a record to start tracking this part of your project.",
}: {
  title?: string;
  detail?: string;
}) {
  return (
    <div className="empty">
      <FolderKanban size={32} />
      <h3>{title}</h3>
      <p>{detail}</p>
    </div>
  );
}
function App() {
  const [materialFilters, setMaterialFilters] = useState<Row>({
    section: "",
    supplier: "",
    po: "",
    risk: "",
    needBy: "",
  });
  const [setup, setSetup] = useState<boolean | null>(null),
    [ws, setWs] = useState<Row | null>(null),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [view, setView] = useState("overview"),
    [project, setProject] = useState(""),
    [query, setQuery] = useState(""),
    [modal, setModal] = useState<Modal | null>(null),
    [busy, setBusy] = useState(false),
    [week, setWeek] = useState(monday(today())),
    [detail, setDetail] = useState<Row | null>(null),
    [menu, setMenu] = useState(false),
    [users, setUsers] = useState<Row[]>([]),
    [reportSection, setReportSection] = useState("");
  const [boardCapacity, setBoardCapacity] = useState<Row[]>([]);
  useEffect(() => {
    let current = true;
    setBoardCapacity([]);
    if (view === "assignments" && ws)
      api(
        "/api/v1/resources/availability?" +
          new URLSearchParams({
            projectId: project,
            from: week,
            to: addDays(week, 6),
          }),
      )
        .then((result) => {
          if (current) setBoardCapacity(result);
        })
        .catch((e) => {
          if (current) setError(e.message);
        });
    return () => {
      current = false;
    };
  }, [view, project, week, ws]);
  const refresh = async () => {
    try {
      const w = await api("/api/v1/workspace");
      setWs(w);
      setSetup(false);
    } catch (e) {
      setWs(null);
    }
  };
  useEffect(() => {
    api("/api/setup")
      .then((s) => {
        setSetup(s.required);
        if (!s.required) void refresh();
      })
      .catch((e) => setError(e.message));
  }, []);
  useEffect(() => {
    if (ws?.actor.role === "admin" && !ws?.readOnly && view === "settings")
      api("/api/v1/users")
        .then(setUsers)
        .catch((e) => setError(e.message));
  }, [view, ws?.actor.id]);
  const run = async (
    fn: () => Promise<any>,
    message = "Saved successfully",
  ) => {
    setBusy(true);
    setError("");
    try {
      const result = await fn();
      setNotice(message);
      await refresh();
      return result;
    } catch (e: any) {
      setError(e.message);
      throw e;
    } finally {
      setBusy(false);
    }
  };
  const action = (fn: () => Promise<any>, message?: string) => {
    void run(fn, message).catch(() => {});
  };
  const actor = ws?.actor || {},
    data = ws?.data || {},
    rows = (kind: string): Row[] => data[kind] || [],
    scoped = (kind: string) =>
      rows(kind).filter((r) => !project || r.projectId === project),
    lookup = (kind: string, id: string) => rows(kind).find((r) => r.id === id),
    label = (kind: string, id: string) => {
      const r = lookup(kind, id);
      return r?.name || r?.description || id || "—";
    };
  const can = (roles: string[]) => !ws?.readOnly && roles.includes(actor.role),
    cost = ["admin", "purchasing"].includes(actor.role),
    manage = can(["admin", "pm"]),
    purchase = can(["admin", "purchasing"]),
    field = can(["admin", "pm", "foreman"]);
  const readies = (ws?.readiness || []).filter(
      (r: Row) => !project || r.projectId === project,
    ),
    forecasts = (ws?.forecast || []).filter(
      (r: Row) => !project || r.projectId === project,
    );
  const filtered = (rs: Row[]) =>
    rs.filter(
      (r) =>
        !query || JSON.stringify(r).toLowerCase().includes(query.toLowerCase()),
    );
  const open = (kind: string, defaults: Row = {}, record?: Row) => {
    setError("");
    setModal({
      kind,
      defaults: {
        projectId: project || rows("project")[0]?.id,
        date: today(),
        ...defaults,
      },
      record,
    });
  };
  const transition = (kind: string, r: Row, status: string) => {
    const reason = ["Rejected", "Correction requested"].includes(status)
      ? window.prompt("Reason for this change")
      : "";
    if (reason === null) return;
    action(
      () =>
        api(`/api/v1/records/${kind}/${r.id}/transition`, {
          status,
          version: r.version,
          reason,
        }),
      `${status} recorded`,
    );
  };
  const table = (
    headers: string[],
    rs: Row[],
    render: (r: Row) => ReactNode,
  ) =>
    !rs.length ? (
      <Empty />
    ) : (
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
            {rs.map((r) => (
              <tr key={r.id || r.taskId || r.partId + "-" + r.locationId}>
                {render(r)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  const edit = (kind: string, r: Row) => (
    <button className="text-button" onClick={() => open(kind, {}, r)}>
      Edit
    </button>
  );
  const title = (
    eyebrow: string,
    name: string,
    description: string,
    buttons?: ReactNode,
  ) => (
    <div className="page-heading">
      <div>
        <div className="eyebrow">{eyebrow}</div>
        <h1>{name}</h1>
        <p>{description}</p>
      </div>
      <div className="actions">{buttons}</div>
    </div>
  );
  const add = (kind: string, text?: string) => (
    <button className="primary" onClick={() => open(kind)}>
      <Plus size={16} />
      {text || `Add ${forms[kind]?.title.toLowerCase()}`}
    </button>
  );
  const stats = (items: { name: string; value: ReactNode; sub: string }[]) => (
    <div className="stats">
      {items.map((s, i) => (
        <div className="stat" key={s.name}>
          <span className="stat-label">
            {s.name}
            <span className="stat-index">0{i + 1}</span>
          </span>
          <strong>{s.value}</strong>
          <small>{s.sub}</small>
        </div>
      ))}
    </div>
  );
  const reportLink = (format: string) =>
    `${BASE}/api/v1/reports/${format}?projectId=${encodeURIComponent(project)}&section=${encodeURIComponent(reportSection)}`;
  if (setup === null)
    return <div className="loading">Connecting to FieldOps…</div>;
  if (!ws)
    return (
      <Auth
        setup={setup}
        error={error}
        onSubmit={async (values) => {
          setError("");
          try {
            await api(setup ? "/api/setup" : "/api/login", values);
            await refresh();
          } catch (e: any) {
            setError(e.message);
          }
        }}
      />
    );
  const readyCount = readies.filter((r: Row) => r.status === "Ready").length,
    actual = forecasts.reduce((s: number, f: Row) => s + (f.actual || 0), 0),
    planned = scoped("assignment")
      .filter((a) => a.status !== "Cancelled")
      .reduce((s, a) => s + a.hours, 0);
  if (actor.role === "vendor")
    return (
      <VendorPortal
        ws={ws}
        api={api}
        refresh={refresh}
        signOut={() => void api("/api/logout", {}).then(() => setWs(null))}
      />
    );
  return (
    <div className="app">
      <aside className={menu ? "sidebar open" : "sidebar"}>
        <a
          className="brand"
          href={BASE + "/"}
          onClick={(e) => {
            e.preventDefault();
            setView("overview");
          }}
        >
          <span className="brand-symbol">
            f<span>↗</span>
          </span>
          <span>
            CAS FieldOps<small>THE FIELD, CONNECTED.</small>
          </span>
        </a>
        <WorkspaceSwitcher
          ws={ws}
          api={api}
          onSwitch={() => {
            setProject("");
            setModal(null);
            setDetail(null);
            setView("overview");
            void refresh();
          }}
        />
        {["admin", "pm", "foreman", "worker"].includes(actor.role) &&
          !ws.readOnly && (
            <a className="button offline-link" href="#offline">
              Offline field kit
            </a>
          )}
        <div className="nav-label">WORKSPACE</div>
        <nav>
          {nav
            .filter(([k]) =>
              actor.role === "viewer"
                ? ["overview", "reports"].includes(k)
                : actor.role === "worker"
                  ? ["overview", "assignments", "time", "workflows"].includes(k)
                  : true,
            )
            .map(([id, name, Icon], i) => (
              <React.Fragment key={id}>
                {i === 5 && (
                  <div className="nav-label">PEOPLE & PRODUCTION</div>
                )}
                {i === 10 && <div className="nav-label">MANAGEMENT</div>}
                <button
                  className={view === id ? "active" : ""}
                  onClick={() => {
                    setView(id);
                    setQuery("");
                    setMenu(false);
                  }}
                >
                  <Icon size={18} />
                  {name}
                  {id === "time" &&
                    scoped("time").some((r) => r.status === "Submitted") && (
                      <span className="nav-dot" />
                    )}
                </button>
              </React.Fragment>
            ))}
        </nav>
        <div className="sidebar-bottom">
          <a href="/Tracking/" target="_blank" rel="noreferrer">
            Built to be yours <ArrowUpRight size={15} />
            <small>Open source · MIT licensed</small>
          </a>
          <div className="profile">
            <span className="avatar">
              {actor.name?.slice(0, 2).toUpperCase()}
            </span>
            <span>
              {actor.name}
              <small>{actor.role}</small>
            </span>
            <button
              disabled={ws.readOnly}
              aria-label="Sign out"
              onClick={() =>
                action(async () => {
                  await api("/api/logout", {});
                  setWs(null);
                }, "Signed out")
              }
            >
              <LogOut size={16} />
            </button>
          </div>
        </div>
      </aside>
      <main>
        <header className="topbar">
          <div className="breadcrumb">
            <button
              className="mobile-menu icon-button"
              aria-label="Open navigation"
              onClick={() => setMenu(!menu)}
            >
              <Menu />
            </button>
            Workspace <span>/</span>
            <b>{nav.find((n) => n[0] === view)?.[1]}</b>
          </div>
          <div className="header-right">
            <span className="saved">
              <i /> Database connected
            </span>
            <button
              className="icon-button"
              aria-label="Refresh workspace"
              onClick={() =>
                action(() => api("/api/v1/workspace"), "Workspace refreshed")
              }
            >
              <RefreshCw size={16} />
            </button>
          </div>
        </header>
        <div className="content">
          <div className="scope-bar">
            <label>
              PROJECT{" "}
              <select
                aria-label="Project filter"
                value={project}
                onChange={(e) => {
                  setProject(e.target.value);
                  setReportSection("");
                }}
              >
                <option value="">All projects</option>
                {rows("project").map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
            <span className="today">
              {new Date().toLocaleDateString("en-US", {
                month: "long",
                day: "numeric",
                year: "numeric",
                timeZone: "America/Denver",
              })}
            </span>
          </div>
          {ws.readOnly && (
            <div className="message">
              <ShieldCheck size={18} />
              Public demo · synthetic project records · read-only.{" "}
              <a
                href="https://github.com/ExJtac/Fieldops"
                target="_blank"
                rel="noreferrer"
              >
                Get the full self-hosted app ↗
              </a>
            </div>
          )}
          {error && (
            <div role="alert" className="message error">
              <AlertTriangle size={18} />
              {error}
              <button aria-label="Dismiss error" onClick={() => setError("")}>
                <X size={16} />
              </button>
            </div>
          )}
          {notice && (
            <div role="status" className="message success">
              <CheckCircle2 size={17} />
              {notice}
              <button aria-label="Dismiss notice" onClick={() => setNotice("")}>
                <X size={16} />
              </button>
            </div>
          )}
          {view === "workflows" && (
            <Workflows
              ws={ws}
              project={project}
              open={open}
              showEvidence={(kind: string, r: Row) =>
                setDetail({ ...r, _kind: kind })
              }
              action={action}
              api={api}
              refresh={refresh}
            />
          )}
          {view === "overview" && (
            <>
              {title(
                "YOUR OPERATIONS, AT A GLANCE",
                "Keep the field moving.",
                "Materials in place. People aligned. Every hour accounted for.",
                manage ? add("project", "New project") : null,
              )}
              {!rows("project").length ? (
                <div className="welcome">
                  <h2>A clear picture starts with your first project.</h2>
                  <p>
                    Create a project and its tasks, then bring in materials and
                    your crew.
                  </p>
                  {manage && add("project")}
                  {actor.role === "admin" && !ws?.readOnly && (
                    <button
                      onClick={() =>
                        action(
                          () => api("/api/v1/demo", {}),
                          "EPCC demonstration workspace loaded",
                        )
                      }
                    >
                      Explore the EPCC demo
                    </button>
                  )}
                </div>
              ) : (
                <>
                  {stats([
                    {
                      name: "Material readiness",
                      value: (
                        <>
                          {readies.length
                            ? Math.round((readyCount / readies.length) * 100)
                            : 0}
                          <em>%</em>
                        </>
                      ),
                      sub: `${readyCount} of ${readies.length} tasks ready`,
                    },
                    {
                      name: "Open constraints",
                      value: readies.filter(
                        (r: Row) =>
                          r.status === "Blocked" || r.status === "Partial",
                      ).length,
                      sub: "Material or release constraints",
                    },
                    {
                      name: "Planned labor",
                      value: (
                        <>
                          {number(planned)}
                          <em>h</em>
                        </>
                      ),
                      sub: "Active assignments · all dates",
                    },
                    {
                      name: "Approved actuals",
                      value:
                        actor.role === "viewer" ? (
                          "Restricted"
                        ) : (
                          <>
                            {number(actual)}
                            <em>h</em>
                          </>
                        ),
                      sub: "Approved & locked time only",
                    },
                  ])}
                  <div className="overview-grid">
                    <section className="panel">
                      <div className="panel-head">
                        <div>
                          <h2>What needs attention</h2>
                          <p>Resolve blockers before they reach the field.</p>
                        </div>
                        <span className="tiny-tag">LIVE FROM YOUR RECORDS</span>
                      </div>
                      {readies
                        .filter((r: Row) => r.status !== "Ready")
                        .slice(0, 5)
                        .map((r: Row, i: number) => (
                          <div className="attention" key={r.taskId}>
                            <span className="attention-icon">
                              <AlertTriangle size={17} />
                            </span>
                            <div>
                              <strong>{r.name}</strong>
                              <p>{r.reason}</p>
                              <small>
                                {r.section} · {label("project", r.projectId)}
                              </small>
                            </div>
                            <Badge>{r.status}</Badge>
                          </div>
                        ))}
                      {!readies.filter((r: Row) => r.status !== "Ready")
                        .length && (
                        <Empty
                          title="No open blockers"
                          detail="Add material requirements to see task readiness here."
                        />
                      )}
                    </section>
                    <section className="field-note">
                      <span className="eyebrow">THE NEXT RIGHT STEP</span>
                      <h2>
                        Turn plans into
                        <br />
                        field progress.
                      </h2>
                      <p>
                        Receive the delivery. Reserve the stock. Assign the
                        crew. Record the work.
                      </p>
                      <div className="flow">
                        <Package />
                        <span />
                        <Users />
                        <span />
                        <CheckCircle2 />
                      </div>
                      <button
                        onClick={() =>
                          setView(
                            actor.role === "viewer" ? "reports" : "materials",
                          )
                        }
                      >
                        Open {actor.role === "viewer" ? "reports" : "materials"}{" "}
                        <ArrowRight size={18} />
                      </button>
                      <small>
                        Forecasts stay separate from approved baselines.
                      </small>
                    </section>
                  </div>
                  <section className="panel">
                    <div className="panel-head">
                      <div>
                        <h2>Work packages</h2>
                        <p>Material readiness and production, by task.</p>
                      </div>
                      <button
                        className="text-button"
                        onClick={() => setView("forecasts")}
                      >
                        View forecasts <ArrowUpRight size={15} />
                      </button>
                    </div>
                    {table(
                      [
                        "Task / section",
                        "Readiness",
                        "Production",
                        "Baseline start",
                      ],
                      readies,
                      (r) => (
                        <>
                          <td>
                            <strong>{r.name}</strong>
                            <small>{r.section}</small>
                          </td>
                          <td>
                            <Badge>{r.status}</Badge>
                          </td>
                          <td>
                            {(() => {
                              const f = forecasts.find(
                                (x: Row) => x.taskId === r.taskId,
                              );
                              return (
                                <>
                                  <span>
                                    {number(f?.installed || 0)} /{" "}
                                    {f?.target
                                      ? number(f.target)
                                      : "Unallocated"}{" "}
                                    {f?.unit}
                                  </span>
                                  <div className="progress">
                                    <i
                                      style={{
                                        width: (f?.progress || 0) + "%",
                                      }}
                                    />
                                  </div>
                                </>
                              );
                            })()}
                          </td>
                          <td>{r.baselineStart || "Unscheduled"}</td>
                        </>
                      ),
                    )}
                  </section>
                </>
              )}
            </>
          )}
          {view === "schedule" && (
            <ScheduleGantt ws={ws} project={project} open={open} />
          )}
          {view === "materials" && (
            <>
              {title(
                "MATERIALS / REQUIREMENTS",
                "Everything the job needs.",
                "Trace the BOM from required quantity to verified task allocation.",
                purchase || manage ? (
                  <>
                    <button onClick={() => open("import")}>
                      <Upload size={16} />
                      Import BOM
                    </button>
                    {add("requirement")}
                  </>
                ) : null,
              )}
              <div className="toolbar">
                <label className="search">
                  <Search size={16} />
                  <input
                    placeholder="Search parts, tasks, or source…"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                  />
                </label>
                <div className="actions">
                  {purchase && (
                    <button onClick={() => open("part")}>
                      <Plus size={15} />
                      Catalog part
                    </button>
                  )}
                  {manage && (
                    <button onClick={() => open("task")}>
                      <Plus size={15} />
                      Task
                    </button>
                  )}
                  {purchase && (
                    <button onClick={() => open("substitution")}>
                      Substitution
                    </button>
                  )}
                </div>
              </div>
              <MaterialWorkspace
                ws={ws}
                project={project}
                api={api}
                onEdit={
                  purchase || manage
                    ? (r) => open("requirement", {}, r)
                    : undefined
                }
              />
              <div className="two-cols">
                <section className="panel">
                  <div className="panel-head">
                    <h2>Part catalog</h2>
                  </div>
                  {table(
                    ["Part", "Manufacturer", "Unit", "Classification", ""],
                    filtered(rows("part")),
                    (r) => (
                      <>
                        <td>
                          <strong>{r.partNumber}</strong>
                          <small>{r.description}</small>
                        </td>
                        <td>{r.manufacturer || "—"}</td>
                        <td>{r.unit}</td>
                        <td>
                          {r.trade} {r.csi} {r.unspsc}
                          <small>
                            {(r.accessoryIds || [])
                              .map((id: string) => label("part", id))
                              .join(", ")}
                          </small>
                        </td>
                        <td>{purchase && edit("part", r)}</td>
                      </>
                    ),
                  )}
                </section>
                <section className="panel">
                  <div className="panel-head">
                    <h2>Substitution approvals</h2>
                  </div>
                  {table(
                    ["Replacement", "Reason", "Status", ""],
                    scoped("substitution"),
                    (r) => (
                      <>
                        <td>{label("part", r.replacementPartId)}</td>
                        <td>{r.reason}</td>
                        <td>
                          <Badge>{r.status}</Badge>
                        </td>
                        <td>
                          {manage && r.status === "Proposed" && (
                            <button
                              onClick={() =>
                                transition("substitution", r, "Approved")
                              }
                            >
                              Approve
                            </button>
                          )}
                        </td>
                      </>
                    ),
                  )}
                </section>
              </div>
            </>
          )}
          {view === "orders" && (
            <>
              {title(
                "PROCUREMENT / SUPPLIERS",
                "From quote to commitment.",
                "Record supplier quotes and approved purchase orders. No email is sent automatically.",
                purchase ? (
                  <>
                    {add("quote", "Record quote")}
                    {add("po", "Create PO")}
                  </>
                ) : null,
              )}
              <div className="toolbar">
                <div className="actions">
                  {purchase && (
                    <>
                      <button onClick={() => open("supplier")}>
                        Add supplier
                      </button>
                      <button onClick={() => open("rfq")}>Create RFQ</button>
                    </>
                  )}
                </div>
                <span className="muted">
                  Supplier costs{" "}
                  {cost ? "visible to your role" : "restricted for your role"}
                </span>
              </div>
              <ProcurementBoard data={data} project={project} />
              <section className="panel">
                <div className="panel-head">
                  <h2>Purchase orders</h2>
                  <span>{scoped("po").length} orders</span>
                </div>
                {table(
                  [
                    "PO / supplier",
                    "Project",
                    "Fulfillment",
                    "Status",
                    ...(cost ? ["Commitment"] : []),
                    "Actions",
                  ],
                  scoped("po"),
                  (r) => {
                    const ordered = r.lines.reduce(
                        (s: number, l: Row) => s + l.quantity,
                        0,
                      ),
                      received = rows("movement")
                        .filter((m) => m.poId === r.id)
                        .reduce((s, m) => s + (m.received || 0), 0);
                    return (
                      <>
                        <td>
                          <strong>{r.number}</strong>
                          <small>{label("supplier", r.supplierId)}</small>
                        </td>
                        <td>{label("project", r.projectId)}</td>
                        <td>
                          {number(received)} / {number(ordered)} units
                          <small>See lines for matching units</small>
                        </td>
                        <td>
                          <Badge>{r.status}</Badge>
                        </td>
                        {cost && (
                          <td>
                            {money(
                              r.lines.reduce(
                                (s: number, l: Row) =>
                                  s + l.quantity * l.unitCost,
                                0,
                              ) +
                                (r.freight || 0) +
                                (r.tax || 0),
                              r.currency,
                            )}
                          </td>
                        )}
                        <td>
                          <div className="row-actions">
                            <button
                              className="text-button"
                              onClick={() => setDetail({ ...r, _kind: "po" })}
                            >
                              View
                            </button>
                            {purchase && r.status === "Draft" && (
                              <>
                                {edit("po", r)}
                                <button
                                  onClick={() =>
                                    transition("po", r, "Submitted")
                                  }
                                >
                                  Submit
                                </button>
                              </>
                            )}
                            {actor.role === "admin" &&
                              !ws?.readOnly &&
                              r.status === "Submitted" && (
                                <button
                                  onClick={() =>
                                    transition("po", r, "Approved")
                                  }
                                >
                                  Approve
                                </button>
                              )}
                            {purchase && r.status === "Approved" && (
                              <button
                                onClick={() => transition("po", r, "Issued")}
                              >
                                Issue
                              </button>
                            )}
                            {purchase && r.status === "Issued" && (
                              <button
                                onClick={() =>
                                  transition("po", r, "Acknowledged")
                                }
                              >
                                Acknowledge
                              </button>
                            )}
                            {purchase &&
                              ["Issued", "Acknowledged"].includes(r.status) && (
                                <>
                                  <button
                                    onClick={() =>
                                      open("promise", {
                                        poId: r.id,
                                        version: r.version,
                                        lines: r.lines,
                                      })
                                    }
                                  >
                                    Update ETA
                                  </button>
                                  <button
                                    onClick={() =>
                                      open("movement", {
                                        action: "receive",
                                        poId: r.id,
                                        projectId: r.projectId,
                                      })
                                    }
                                  >
                                    Receive
                                  </button>
                                  <button
                                    className="text-button danger-text"
                                    onClick={() => {
                                      if (
                                        confirm(
                                          "Cancel the unreceived balance? Received stock and history will remain.",
                                        )
                                      )
                                        transition("po", r, "Cancelled");
                                    }}
                                  >
                                    Cancel balance
                                  </button>
                                </>
                              )}
                          </div>
                        </td>
                      </>
                    );
                  },
                )}
              </section>
              {cost && (
                <QuoteComparison
                  ws={ws}
                  project={project}
                  api={api}
                  open={open}
                />
              )}
              <section className="panel">
                <div className="panel-head">
                  <h2>RFQ register</h2>
                </div>
                {table(
                  ["Supplier", "Part", "Quantity", "Need by", "Status", ""],
                  scoped("rfq"),
                  (r) => (
                    <>
                      <td>{label("supplier", r.supplierId)}</td>
                      <td>{label("part", r.partId)}</td>
                      <td>{number(r.quantity)}</td>
                      <td>{r.needBy || "—"}</td>
                      <td>
                        <Badge>{r.status}</Badge>
                      </td>
                      <td>
                        {purchase && r.status === "Draft" && (
                          <button
                            onClick={() => transition("rfq", r, "Recorded")}
                          >
                            Mark recorded
                          </button>
                        )}
                      </td>
                    </>
                  ),
                )}
              </section>
            </>
          )}
          {view === "deliveries" && (
            <>
              {title(
                "DELIVERIES / RECEIVING",
                "Know what is on the way.",
                "Keep supplier promises separate from forecasts and unconfirmed lead times.",
                purchase ? add("movement", "Record receipt") : null,
              )}
              <section className="panel">
                {table(
                  [
                    "PO / part",
                    "Ordered",
                    "Received",
                    "Remaining",
                    "Confirmed ETA",
                    "Forecast ETA",
                    "",
                  ],
                  scoped("po").flatMap((p) =>
                    p.lines.map((l: Row) => ({
                      ...l,
                      id: p.id + l.id,
                      lineId: l.id,
                      po: p,
                      received: rows("movement")
                        .filter((m) => m.poId === p.id && m.lineId === l.id)
                        .reduce((s, m) => s + (m.received || 0), 0),
                    })),
                  ),
                  (r) => (
                    <>
                      <td>
                        <strong>{label("part", r.partId)}</strong>
                        <small>
                          {r.po.number} · {r.po.status}
                        </small>
                      </td>
                      <td>{number(r.quantity)}</td>
                      <td>{number(r.received)}</td>
                      <td>
                        {r.po.status === "Cancelled"
                          ? "Cancelled"
                          : number(r.quantity - r.received)}
                      </td>
                      <td>{r.confirmedETA || <Badge>Unconfirmed</Badge>}</td>
                      <td>
                        {r.ackDate
                          ? `${addDays(r.ackDate, r.leadMin)} – ${addDays(r.ackDate, r.leadMax)}`
                          : `${r.leadMin}–${r.leadMax} days ARO; start unknown`}
                      </td>
                      <td>
                        {purchase &&
                          ["Issued", "Acknowledged"].includes(r.po.status) && (
                            <button
                              onClick={() =>
                                open("movement", {
                                  action: "receive",
                                  poId: r.po.id,
                                  lineId: r.lineId,
                                  partId: r.partId,
                                  projectId: r.po.projectId,
                                })
                              }
                            >
                              Receive
                            </button>
                          )}
                      </td>
                    </>
                  ),
                )}
              </section>
            </>
          )}
          {view === "inventory" && (
            <>
              {title(
                "INVENTORY / CUSTODY",
                "One unit. One place.",
                "Every movement is recorded. Reserved stock cannot be promised to another task.",
                can(["admin", "purchasing", "foreman"]) ? (
                  <>
                    <button onClick={() => open("location")}>
                      Add location
                    </button>
                    {add("movement", "Move stock")}
                  </>
                ) : null,
              )}
              <section className="panel">
                <div className="panel-head">
                  <h2>Stock across the workspace</h2>
                  <span>All projects · shared physical inventory</span>
                </div>
                {table(
                  [
                    "Part",
                    "Location",
                    "On hand",
                    "Reserved",
                    "Available",
                    "Issued",
                    "Installed",
                  ],
                  (ws.balances || []).filter(
                    (r: Row) =>
                      r.onHand || r.reserved || r.issued || r.installed,
                  ),
                  (r) => (
                    <>
                      <td>{label("part", r.partId)}</td>
                      <td>{label("location", r.locationId)}</td>
                      <td>{number(r.onHand)}</td>
                      <td>{number(r.reserved)}</td>
                      <td>
                        <strong>{number(r.available)}</strong>
                      </td>
                      <td>{number(r.issued)}</td>
                      <td>{number(r.installed)}</td>
                    </>
                  ),
                )}
              </section>
              <section className="panel">
                <div className="panel-head">
                  <div>
                    <h2>Movement ledger</h2>
                    <p>
                      Correct mistakes with reversals; original history stays
                      intact.
                    </p>
                  </div>
                </div>
                {table(
                  [
                    "Recorded",
                    "Movement",
                    "Part / location",
                    "Quantity",
                    "Reference / note",
                    "",
                  ],
                  scoped("movement").slice().reverse(),
                  (r) => (
                    <>
                      <td>{new Date(r.createdAt).toLocaleString()}</td>
                      <td>
                        <Badge>{r.action}</Badge>
                      </td>
                      <td>
                        {label("part", r.partId)}
                        <small>{label("location", r.locationId)}</small>
                      </td>
                      <td>{number(r.quantity)}</td>
                      <td>
                        {r.note}
                        <small>
                          {r.taskId
                            ? label("task", r.taskId)
                            : lookup("po", r.poId)?.number}
                        </small>
                      </td>
                      <td>
                        <button
                          className="text-button"
                          onClick={() => setDetail({ ...r, _kind: "movement" })}
                        >
                          Evidence
                        </button>
                        {actor.role === "admin" &&
                          !ws?.readOnly &&
                          !["reverse", "transfer", "transfer-in"].includes(
                            r.action,
                          ) && (
                            <button
                              className="text-button"
                              onClick={() =>
                                open("movement", {
                                  ...r,
                                  action: "reverse",
                                  referenceId: r.id,
                                  note: "",
                                })
                              }
                            >
                              Reverse
                            </button>
                          )}
                      </td>
                    </>
                  ),
                )}
              </section>
            </>
          )}
          {view === "crews" && (
            <>
              {title(
                "PEOPLE / CAPACITY",
                "The right people for the work.",
                "Trade, certifications, crews, and availability. Payroll rates are not stored here.",
                manage ? (
                  <>
                    <button onClick={() => open("leave")}>Record leave</button>
                    {add("worker")}
                  </>
                ) : null,
              )}
              <div className="crew-cards">
                {rows("worker").map((w) => (
                  <article className="worker-card" key={w.id}>
                    <div className="worker-head">
                      <span className="avatar large">
                        {w.name
                          .split(" ")
                          .slice(0, 2)
                          .map((s: string) => s[0])
                          .join("")}
                      </span>
                      <Badge>{w.active ? "Active" : "Inactive"}</Badge>
                    </div>
                    <h3>{w.name}</h3>
                    <p>
                      {w.trade} · {w.kind}
                    </p>
                    <div className="worker-meta">
                      <span>{w.crew || "Unassigned crew"}</span>
                      <b>{w.dailyHours}h / day</b>
                    </div>
                    <div className="skills">
                      {w.skills.map((s: Row) => (
                        <span
                          key={s.name}
                          className={
                            s.expires && s.expires < today() ? "expired" : ""
                          }
                        >
                          {s.name}
                          <small>
                            {s.expires ? `Expires ${s.expires}` : "No expiry"}
                          </small>
                        </span>
                      ))}
                    </div>
                    {manage && edit("worker", w)}
                  </article>
                ))}
              </div>
              {!rows("worker").length && <Empty />}
              <section className="panel">
                <div className="panel-head">
                  <h2>Leave and availability exceptions</h2>
                </div>
                {table(
                  ["Worker", "Date", "Unavailable hours", "Reason"],
                  rows("leave"),
                  (r) => (
                    <>
                      <td>{label("worker", r.workerId)}</td>
                      <td>{r.date}</td>
                      <td>{r.hours}h</td>
                      <td>{r.reason}</td>
                    </>
                  ),
                )}
              </section>
            </>
          )}
          {view === "assignments" && (
            <>
              {title(
                "RESOURCE BOARD / WEEKLY VIEW",
                "A crew plan that adds up.",
                "Drag assignments between dates or use Edit. Capacity checks include every project.",
                manage ? (
                  <>
                    <button onClick={() => open("crewAssignment")}>
                      Assign whole crew
                    </button>
                    {add("assignment")}
                  </>
                ) : null,
              )}
              <div className="toolbar">
                <div className="actions">
                  <button onClick={() => setWeek(addDays(week, -7))}>
                    ← Previous
                  </button>
                  <input
                    aria-label="Week starting"
                    type="date"
                    value={week}
                    onChange={(e) =>
                      e.target.value && setWeek(monday(e.target.value))
                    }
                  />
                  <button onClick={() => setWeek(addDays(week, 7))}>
                    Next →
                  </button>
                </div>
                <span className="muted">
                  {week} — {addDays(week, 6)}
                </span>
              </div>
              <div className="resource-board">
                <div className="board-row board-header">
                  <div>WORKER / CREW</div>
                  {Array.from({ length: 7 }, (_, i) => (
                    <div key={i}>
                      {new Date(
                        addDays(week, i) + "T12:00:00Z",
                      ).toLocaleDateString("en-US", {
                        weekday: "short",
                        day: "numeric",
                        timeZone: "UTC",
                      })}
                    </div>
                  ))}
                </div>
                {rows("worker").map((w) => (
                  <div className="board-row" key={w.id}>
                    <div className="board-person">
                      <strong>{w.name}</strong>
                      <small>
                        {[
                          ...new Set(
                            boardCapacity
                              .filter((r) => r.workerId === w.id)
                              .map((r) => r.crew)
                              .filter(Boolean),
                          ),
                        ].join(" / ") ||
                          w.crew ||
                          w.trade}{" "}
                        · {w.dailyHours}h/day
                      </small>
                    </div>
                    {Array.from({ length: 7 }, (_, i) => {
                      const date = addDays(week, i),
                        all = rows("assignment").filter(
                          (a) =>
                            a.workerId === w.id &&
                            a.date === date &&
                            a.status !== "Cancelled",
                        ),
                        items = all.filter(
                          (a) => !project || a.projectId === project,
                        ),
                        hours = all.reduce((s, a) => s + a.hours, 0);
                      const capacityRow = boardCapacity.find(
                        (r) => r.workerId === w.id && r.date === date,
                      );
                      const available = capacityRow?.capacity;
                      const plannedAllJobs =
                        capacityRow?.plannedAllJobs ?? hours;
                      return (
                        <div
                          key={i}
                          className="board-cell"
                          onDragOver={(e) => manage && e.preventDefault()}
                          onDrop={(e) => {
                            e.preventDefault();
                            const r = lookup(
                              "assignment",
                              e.dataTransfer.getData("text/plain"),
                            );
                            if (r && manage)
                              action(
                                () =>
                                  api(
                                    "/api/v1/assignments/" + r.id,
                                    {
                                      ...r,
                                      date,
                                      workerId: w.id,
                                      override: "",
                                    },
                                    "PATCH",
                                  ),
                                "Assignment moved",
                              );
                          }}
                        >
                          {items.map((a) => (
                            <button
                              key={a.id}
                              draggable={manage}
                              onDragStart={(e) =>
                                e.dataTransfer.setData("text/plain", a.id)
                              }
                              className="assignment"
                              onClick={() =>
                                manage
                                  ? open("assignment", {}, a)
                                  : setDetail(a)
                              }
                            >
                              <strong>{label("project", a.projectId)}</strong>
                              <span>{label("task", a.taskId)}</span>
                              <b>
                                {a.hours}h · {a.start}:00
                              </b>
                              {a.currentConflicts?.length > 0 && (
                                <small className="danger-text">
                                  {a.override
                                    ? "Override · review current conflicts"
                                    : "Capacity / skill conflict"}
                                </small>
                              )}
                            </button>
                          ))}
                          <small
                            className={
                              available != null && plannedAllJobs > available
                                ? "danger-text"
                                : "capacity"
                            }
                          >
                            {available == null
                              ? "Checking capacity…"
                              : `${number(plannedAllJobs)}h planned / ${number(available)}h capacity`}
                          </small>
                          {rows("leave")
                            .filter(
                              (l) => l.workerId === w.id && l.date === date,
                            )
                            .map((l) => (
                              <small className="leave" key={l.id}>
                                Leave · {l.hours}h
                              </small>
                            ))}
                        </div>
                      );
                    })}
                  </div>
                ))}
              </div>
              {!rows("worker").length && (
                <Empty
                  title="Add your crew first"
                  detail="People & crews contains the worker directory."
                />
              )}
            </>
          )}
          {view === "time" && (
            <>
              {title(
                "TIMESHEETS / REVIEW",
                "Every hour, accounted for.",
                "Draft and submitted time do not affect actual labor totals.",
                can(["admin", "pm", "foreman", "worker"]) ? (
                  <>
                    {field && (
                      <button onClick={() => open("crewTime")}>
                        Bulk crew entry
                      </button>
                    )}
                    {add("time")}
                  </>
                ) : null,
              )}
              {stats([
                {
                  name: "Awaiting approval",
                  value: scoped("time").filter((t) => t.status === "Submitted")
                    .length,
                  sub: "Submitted time entries",
                },
                {
                  name: "Approved hours",
                  value: number(actual),
                  sub: "Includes locked entries",
                },
                {
                  name: "Draft hours",
                  value: number(
                    scoped("time")
                      .filter((t) => t.status === "Draft")
                      .reduce((s, t) => s + t.regular + t.overtime, 0),
                  ),
                  sub: "Excluded from actuals",
                },
              ])}
              <section className="panel">
                {table(
                  [
                    "Worker / date",
                    "Task",
                    "Regular",
                    "Overtime",
                    "Status",
                    "Actions",
                  ],
                  scoped("time").slice().reverse(),
                  (r) => (
                    <>
                      <td>
                        <strong>{label("worker", r.workerId)}</strong>
                        <small>{r.date}</small>
                      </td>
                      <td>
                        {label("task", r.taskId)}
                        <small>{r.notes}</small>
                      </td>
                      <td>{r.regular}h</td>
                      <td>{r.overtime}h</td>
                      <td>
                        <Badge>{r.status}</Badge>
                      </td>
                      <td>
                        <div className="row-actions">
                          {!["worker", "viewer"].includes(actor.role) && (
                            <button
                              className="text-button"
                              onClick={() => setDetail({ ...r, _kind: "time" })}
                            >
                              Evidence
                            </button>
                          )}
                          {["Draft", "Rejected"].includes(r.status) &&
                            edit("time", r)}
                          {r.status === "Draft" && (
                            <button
                              onClick={() => transition("time", r, "Submitted")}
                            >
                              Submit
                            </button>
                          )}
                          {manage && r.status === "Submitted" && (
                            <>
                              <button
                                onClick={() =>
                                  transition("time", r, "Approved")
                                }
                              >
                                Approve
                              </button>
                              <button
                                onClick={() =>
                                  transition("time", r, "Rejected")
                                }
                              >
                                Reject
                              </button>
                            </>
                          )}
                          {manage && r.status === "Approved" && (
                            <button
                              onClick={() => transition("time", r, "Locked")}
                            >
                              Lock
                            </button>
                          )}
                          {["Approved", "Locked"].includes(r.status) && (
                            <button
                              onClick={() =>
                                transition("time", r, "Correction requested")
                              }
                            >
                              Request correction
                            </button>
                          )}
                          {manage && r.status === "Correction requested" && (
                            <button
                              onClick={() => transition("time", r, "Rejected")}
                            >
                              Reopen with reason
                            </button>
                          )}
                        </div>
                      </td>
                    </>
                  ),
                )}
              </section>
            </>
          )}
          {view === "production" && (
            <>
              {title(
                "FIELD EXECUTION / PRODUCTION",
                "Measure the work installed.",
                "Approved quantities update only their linked task and section.",
                field ? add("production", "Record production") : null,
              )}
              <section className="panel">
                {table(
                  [
                    "Date",
                    "Task / section",
                    "Installed",
                    "Status",
                    "Notes",
                    "Review",
                  ],
                  scoped("production").slice().reverse(),
                  (r) => (
                    <>
                      <td>{r.date}</td>
                      <td>
                        {label("task", r.taskId)}
                        <small>{lookup("task", r.taskId)?.section}</small>
                      </td>
                      <td>
                        {r.quantity} {r.unit}
                      </td>
                      <td>
                        <Badge>{r.status}</Badge>
                      </td>
                      <td>{r.notes}</td>
                      <td>
                        {manage && r.status === "Submitted" && (
                          <div className="row-actions">
                            <button
                              onClick={() =>
                                transition("production", r, "Approved")
                              }
                            >
                              Approve
                            </button>
                            <button
                              onClick={() =>
                                transition("production", r, "Rejected")
                              }
                            >
                              Reject
                            </button>
                          </div>
                        )}
                      </td>
                    </>
                  ),
                )}
              </section>
            </>
          )}
          {view === "forecasts" && (
            <>
              {title(
                "FORECASTS / LOOKAHEAD",
                "Plan the next move.",
                "Compare planned, approved actual, and earned hours without changing the baseline.",
                manage ? (
                  <>
                    <button onClick={() => open("hold")}>
                      Add schedule hold
                    </button>
                    {add("reforecast", "Reforecast labor")}
                  </>
                ) : null,
              )}
              <section className="panel">
                {table(
                  [
                    "Task / section",
                    "Planned",
                    "Actual",
                    "Earned",
                    "Remaining",
                    "At completion",
                    "Production",
                  ],
                  forecasts,
                  (r) => (
                    <>
                      <td>
                        <strong>{r.name}</strong>
                        <small>
                          {r.section} · {r.laborType}
                        </small>
                      </td>
                      <td>{number(r.planned)}h</td>
                      <td>{number(r.actual)}h</td>
                      <td>{number(r.earned)}h</td>
                      <td>
                        {r.remaining == null
                          ? "Not forecast"
                          : number(r.remaining) + "h"}
                      </td>
                      <td>
                        {r.estimateAtCompletion == null
                          ? "Not forecast"
                          : number(r.estimateAtCompletion) + "h"}
                      </td>
                      <td>
                        {number(r.installed)} / {r.target || "Unallocated"}{" "}
                        {r.unit}
                      </td>
                    </>
                  ),
                )}
              </section>
              <p className="message">
                Use Operations center → Crew & schedule for material- and
                calendar-aware crew scenarios.
              </p>
              <div className="two-cols">
                <section className="panel">
                  <div className="panel-head">
                    <h2>Labor reforecasts</h2>
                  </div>
                  {table(
                    ["Task", "Remaining", "Status", ""],
                    scoped("reforecast"),
                    (r) => (
                      <>
                        <td>
                          {label("task", r.taskId)}
                          <small>{r.reason}</small>
                        </td>
                        <td>{r.remainingHours}h</td>
                        <td>
                          <Badge>{r.status}</Badge>
                        </td>
                        <td>
                          {manage && r.status === "Proposed" && (
                            <button
                              onClick={() =>
                                transition("reforecast", r, "Approved")
                              }
                            >
                              Approve
                            </button>
                          )}
                        </td>
                      </>
                    ),
                  )}
                </section>
                <section className="panel">
                  <div className="panel-head">
                    <h2>Schedule constraints</h2>
                  </div>
                  {table(
                    ["Task / reason", "Proposal", "Status", ""],
                    scoped("hold"),
                    (r) => (
                      <>
                        <td>
                          {label("task", r.taskId)}
                          <small>{r.reason}</small>
                        </td>
                        <td>{r.proposedStart || "No date change"}</td>
                        <td>
                          <Badge>{r.status}</Badge>
                        </td>
                        <td>
                          {manage && r.status === "Proposed" && (
                            <button
                              onClick={() => transition("hold", r, "Approved")}
                            >
                              Approve hold
                            </button>
                          )}
                          {manage && r.status === "Approved" && (
                            <button
                              onClick={() => transition("hold", r, "Resolved")}
                            >
                              Resolve
                            </button>
                          )}
                        </td>
                      </>
                    ),
                  )}
                </section>
              </div>
            </>
          )}
          {view === "reports" && (
            <>
              {title(
                "REPORTS / TRACEABILITY",
                "The records behind the numbers.",
                "Export project and section totals, or print a report to PDF.",
              )}
              <section className="panel export-panel">
                <div>
                  <h2>Operations report</h2>
                  <p>
                    Uses the project filter above. Financial fields follow your
                    account permissions.
                  </p>
                  <label>
                    Section{" "}
                    <select
                      value={reportSection}
                      onChange={(e) => setReportSection(e.target.value)}
                    >
                      <option value="">All sections</option>
                      {[...new Set(scoped("task").map((t) => t.section))].map(
                        (s) => (
                          <option key={s}>{s}</option>
                        ),
                      )}
                    </select>
                  </label>
                </div>
                <div className="actions">
                  <a className="button" href={reportLink("csv")}>
                    <Download size={16} />
                    Labor CSV
                  </a>
                  <a className="button" href={reportLink("xlsx")}>
                    <Download size={16} />
                    Excel report
                  </a>
                  <a className="button" href={reportLink("json")}>
                    <Download size={16} />
                    Integration JSON
                  </a>
                  <button onClick={() => window.print()}>Print / PDF</button>
                </div>
              </section>
              <section className="panel">
                <div className="panel-head">
                  <h2>Task readiness report</h2>
                </div>
                {table(
                  ["Task", "Section", "Status", "Reason"],
                  readies.filter(
                    (r: Row) => !reportSection || r.section === reportSection,
                  ),
                  (r) => (
                    <>
                      <td>{r.name}</td>
                      <td>{r.section}</td>
                      <td>
                        <Badge>{r.status}</Badge>
                      </td>
                      <td>{r.reason}</td>
                    </>
                  ),
                )}
              </section>
              {manage && (
                <section className="panel">
                  <div className="panel-head">
                    <h2>Audit trail</h2>
                    <span>Most recent 500 workspace events</span>
                  </div>
                  {table(
                    ["Timestamp", "Action", "Entity", "Actor"],
                    ws.audit || [],
                    (r) => (
                      <>
                        <td>{new Date(r.at).toLocaleString()}</td>
                        <td>{r.action}</td>
                        <td>
                          <code>{r.entity.slice(0, 12)}</code>
                        </td>
                        <td>
                          <code>{r.actor.slice(0, 12)}</code>
                        </td>
                      </>
                    ),
                  )}
                </section>
              )}
            </>
          )}
          {view === "settings" && (
            <>
              {title(
                "WORKSPACE / ADMINISTRATION",
                "Built around your team.",
                "Manage projects, task scope, access, and approval policy.",
                !ws.readOnly ? (
                  <>
                    <button onClick={() => open("password")}>
                      Change password
                    </button>
                    {manage && add("project")}
                  </>
                ) : null,
              )}
              <section className="panel">
                <div className="panel-head">
                  <h2>Projects & budgets</h2>
                </div>
                {table(
                  ["Project", "Customer", "Field budget", "PM budget", ""],
                  rows("project"),
                  (r) => (
                    <>
                      <td>
                        <strong>{r.name}</strong>
                        <small>{r.timezone}</small>
                      </td>
                      <td>{r.customer}</td>
                      <td>{number(r.fieldBudget)}h</td>
                      <td>{number(r.pmBudget)}h</td>
                      <td>{manage && edit("project", r)}</td>
                    </>
                  ),
                )}
              </section>
              <section className="panel">
                <div className="panel-head">
                  <h2>Task scope</h2>
                  {manage && add("task")}
                </div>
                {table(
                  ["Task", "Project / section", "Target", "Baseline", ""],
                  scoped("task"),
                  (r) => (
                    <>
                      <td>{r.name}</td>
                      <td>
                        {label("project", r.projectId)}
                        <small>{r.section}</small>
                      </td>
                      <td>
                        {r.target} {r.unit}
                      </td>
                      <td>
                        {r.baselineStart || "—"} → {r.baselineEnd || "—"}
                      </td>
                      <td>{manage && edit("task", r)}</td>
                    </>
                  ),
                )}
              </section>
              {actor.role === "admin" && !ws?.readOnly && (
                <>
                  <section className="panel">
                    <div className="panel-head">
                      <div>
                        <h2>Team access</h2>
                        <p>
                          Accounts belong to this organization. Workers see
                          their assignments and time; viewers see progress.
                        </p>
                      </div>
                      {add("user", "Add account")}
                    </div>
                    {table(["Name", "Email", "Role", "Access"], users, (r) => (
                      <>
                        <td>{r.name}</td>
                        <td>{r.email}</td>
                        <td>
                          <Badge>{r.role}</Badge>
                        </td>
                        <td>
                          {r.id !== actor.id && (
                            <button
                              onClick={() =>
                                action(async () => {
                                  await api(
                                    "/api/v1/users/" + r.id + "/active",
                                    { active: !r.active },
                                  );
                                  setUsers(await api("/api/v1/users"));
                                }, "Account access updated")
                              }
                            >
                              {r.active ? "Deactivate" : "Activate"}
                            </button>
                          )}
                        </td>
                      </>
                    ))}
                  </section>
                  <section className="panel settings-policy">
                    <ShieldCheck />
                    <div>
                      <h2>Separate request and approval</h2>
                      <p>
                        Require a different person to approve restricted
                        purchases, time, and production. Create a second
                        approver before enabling.
                      </p>
                    </div>
                    <button
                      onClick={() =>
                        action(
                          () =>
                            api("/api/v1/settings", {
                              version: rows("settings")[0]?.version,
                              separation: !rows("settings")[0]?.separation,
                            }),
                          "Approval policy updated",
                        )
                      }
                    >
                      {rows("settings")[0]?.separation
                        ? "Enabled · turn off"
                        : "Disabled · enable"}
                    </button>
                  </section>
                </>
              )}
              <section className="panel">
                <div className="panel-head">
                  <h2>Change register</h2>
                  {manage && add("change")}
                </div>
                {table(
                  ["Change", "Source", "Status", ""],
                  scoped("change"),
                  (r) => (
                    <>
                      <td>
                        <strong>{r.title}</strong>
                        <small>{r.description}</small>
                      </td>
                      <td>{r.source}</td>
                      <td>
                        <Badge>{r.status}</Badge>
                      </td>
                      <td>
                        {manage && r.status === "Proposed" && (
                          <button
                            onClick={() => transition("change", r, "Approved")}
                          >
                            Approve
                          </button>
                        )}
                      </td>
                    </>
                  ),
                )}
              </section>
            </>
          )}
          <footer className="footer">
            <span>
              CAS FieldOps <b>·</b> Open source. On your terms.
            </span>
            <span>
              v0.3.1 ·{" "}
              {actor.role === "admin" ? "Workspace administrator" : actor.role}
            </span>
          </footer>
        </div>
      </main>
      {modal && (
        <div
          className="modal-backdrop"
          onClick={(e) => {
            if (e.target === e.currentTarget && !busy) setModal(null);
          }}
        >
          <section
            className={
              "modal " + (["import", "po"].includes(modal.kind) ? "wide" : "")
            }
            role="dialog"
            aria-modal="true"
            aria-labelledby="dialog-title"
          >
            <header>
              <div>
                <span className="eyebrow">
                  FIELDOPS / {modal.record ? "UPDATE" : "NEW RECORD"}
                </span>
                <h2 id="dialog-title">
                  {modal.kind === "movement"
                    ? "Inventory movement"
                    : modal.kind === "import"
                      ? "Review a BOM import"
                      : forms[modal.kind]?.title}
                </h2>
              </div>
              <button aria-label="Close dialog" onClick={() => setModal(null)}>
                <X size={20} />
              </button>
            </header>
            {ws.readOnly && (
              <div className="message">
                <ShieldCheck size={18} />
                Public demo · synthetic project records · read-only.{" "}
                <a
                  href="https://github.com/ExJtac/Fieldops"
                  target="_blank"
                  rel="noreferrer"
                >
                  Get the full self-hosted app ↗
                </a>
              </div>
            )}
            {error && (
              <div role="alert" className="message error">
                {error}
              </div>
            )}
            {modal.kind === "import" ? (
              <ImportForm
                project={project || rows("project")[0]?.id}
                data={data}
                onSave={async (b) => {
                  await run(
                    () => api("/api/v1/imports/commit", b),
                    "Reviewed BOM imported",
                  );
                  setModal(null);
                }}
              />
            ) : (
              <RecordForm
                key={modal.kind + (modal.record?.id || "")}
                modal={modal}
                data={data}
                actor={actor}
                busy={busy}
                onSave={async (b) => {
                  let path = "/api/v1/records/" + modal.kind,
                    method = "POST";
                  if (modal.kind.startsWith("op:"))
                    path = "/api/v1/operations/" + modal.kind.slice(3);
                  else if (modal.kind.startsWith("plan:"))
                    path = "/api/v1/planning/" + modal.kind.slice(5);
                  else if (modal.kind === "movement")
                    path = "/api/v1/inventory/movements";
                  else if (modal.kind === "promise")
                    path = "/api/v1/purchase-orders/" + b.poId + "/promises";
                  else if (modal.kind === "crewTime")
                    path = "/api/v1/crews/time";
                  else if (modal.kind === "crewAssignment")
                    path = "/api/v1/crews/assignment";
                  else if (modal.kind === "password")
                    path = "/api/v1/me/password";
                  else if (modal.kind.startsWith("tenant:"))
                    path =
                      "/api/v1/tenants" +
                      (modal.kind === "tenant:create"
                        ? ""
                        : modal.kind === "tenant:member"
                          ? "/members"
                          : "/owner");
                  else if (modal.kind === "user") path = "/api/v1/users";
                  else if (modal.record) {
                    path += `/${modal.record.id}`;
                    method = "PATCH";
                    if (modal.kind === "assignment")
                      path = "/api/v1/assignments/" + modal.record.id;
                  }
                  await run(() => api(path, b, method));
                  if (modal.kind === "password") setWs(null);
                  if (modal.kind === "user")
                    setUsers(await api("/api/v1/users"));
                  setModal(null);
                }}
                onCancel={() => setModal(null)}
                onDelete={
                  modal.record && modal.kind === "assignment"
                    ? async () => {
                        await run(
                          () =>
                            api(
                              "/api/v1/assignments/" +
                                modal.record!.id +
                                "/cancel",
                              { version: modal.record!.version },
                            ),
                          "Assignment cancelled",
                        );
                        setModal(null);
                      }
                    : undefined
                }
              />
            )}
          </section>
        </div>
      )}
      {detail && (
        <div className="modal-backdrop">
          <section
            className="modal wide"
            role="dialog"
            aria-modal="true"
            aria-label="Record details"
          >
            <header>
              <h2>{detail.number || detail.partNumber || "Record detail"}</h2>
              <button
                aria-label="Close details"
                onClick={() => setDetail(null)}
              >
                <X />
              </button>
            </header>
            {detail._kind === "po" ? (
              <>
                <p>{detail.notes}</p>
                {table(
                  ["Part", "Quantity", "ETA", ...(cost ? ["Unit cost"] : [])],
                  detail.lines,
                  (r) => (
                    <>
                      <td>{label("part", r.partId)}</td>
                      <td>{r.quantity}</td>
                      <td>{r.confirmedETA || "Unconfirmed"}</td>
                      {cost && <td>{money(r.unitCost, detail.currency)}</td>}
                    </>
                  ),
                )}
                <p>
                  Revision {detail.version} · {detail.status}. Printing does not
                  issue or email this order.
                </p>
                <button onClick={() => window.print()}>Print PO / PDF</button>
              </>
            ) : (
              <div className="detail-list">
                {Object.entries(detail).map(([k, v]) => (
                  <div key={k}>
                    <b>{k}</b>
                    <span>
                      {typeof v === "object"
                        ? JSON.stringify(v)
                        : String(v ?? "—")}
                    </span>
                  </div>
                ))}
              </div>
            )}
            {detail._kind &&
              actor.role !== "viewer" &&
              (actor.role !== "worker" ||
                ["time", "production"].includes(detail._kind)) && (
                <Evidence
                  kind={detail._kind}
                  id={detail.id}
                  readOnly={ws.readOnly}
                  canShare={cost}
                />
              )}
          </section>
        </div>
      )}
    </div>
  );
}
function Auth({
  setup,
  error,
  onSubmit,
}: {
  setup: boolean;
  error: string;
  onSubmit: (b: Row) => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <div className="auth-page">
      <div className="auth-story">
        <div className="brand">
          <span className="brand-symbol">f↗</span>
          <span>CAS FieldOps</span>
        </div>
        <span className="eyebrow">BUILT FOR THE PEOPLE BUILDING.</span>
        <h1>
          A clearer picture.
          <br />A better day
          <br />
          in the field.
        </h1>
        <p>
          Connect your materials, crews, and daily progress in one workspace you
          own.
        </p>
        <div className="auth-chips">
          <span>
            <Package size={17} />
            Material tracking
          </span>
          <span>
            <Users size={17} />
            Crew planning
          </span>
          <span>
            <CheckCircle2 size={17} />
            Approved actuals
          </span>
        </div>
        <small>Open source · MIT licensed · Self-hosted</small>
      </div>
      <div className="auth-form">
        <span className="eyebrow">WELCOME TO YOUR WORKSPACE</span>
        <h2>{setup ? "Make it yours." : "Welcome back."}</h2>
        <p>
          {setup
            ? "Create the first administrator account on this installation."
            : "Sign in to your organization’s FieldOps workspace."}
        </p>
        {error && (
          <div className="message error" role="alert">
            {error}
          </div>
        )}
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            setBusy(true);
            try {
              await onSubmit({
                ...Object.fromEntries(f),
                demo: f.get("demo") === "on",
              });
            } finally {
              setBusy(false);
            }
          }}
        >
          {setup && (
            <>
              <label>
                Organization
                <input
                  name="organization"
                  required
                  defaultValue="CAS-TX"
                  autoComplete="organization"
                />
              </label>
              <label>
                Your name
                <input name="name" required autoComplete="name" />
              </label>
            </>
          )}
          <label>
            Email
            <input name="email" type="email" required autoComplete="username" />
          </label>
          <label>
            Password
            <input
              name="password"
              type="password"
              minLength={setup ? 12 : undefined}
              maxLength={256}
              required
              autoComplete={setup ? "new-password" : "current-password"}
            />
          </label>
          {setup && (
            <>
              <small>
                Use at least 12 characters. Passwords are hashed on the server.
              </small>
              <label className="check-label">
                <input name="demo" type="checkbox" defaultChecked />
                Load clearly labeled EPCC demonstration data
              </label>
            </>
          )}
          <button className="primary" disabled={busy}>
            {busy ? "Connecting…" : setup ? "Create workspace" : "Sign in"}{" "}
            <ArrowRight size={17} />
          </button>
        </form>
        <p className="auth-foot">
          Your records stay in this installation’s database.
        </p>
      </div>
    </div>
  );
}
function RecordForm({
  modal,
  data,
  actor,
  busy,
  onSave,
  onCancel,
  onDelete,
}: {
  modal: Modal;
  data: Row;
  actor: Row;
  busy: boolean;
  onSave: (b: Row) => Promise<void>;
  onCancel: () => void;
  onDelete?: () => Promise<void>;
}) {
  const kind = modal.kind;
  let fields = forms[kind]?.fields || [];
  if (kind === "movement")
    fields = [
      {
        key: "action",
        label: "Movement",
        type: "select",
        options: [
          "receive",
          "inspect",
          "reserve",
          "release",
          "issue",
          "install",
          "return",
          "transfer",
          ...(actor.role === "admin" ? ["reverse"] : []),
        ],
        default: "receive",
      },
      {
        key: "partId",
        label: "Part",
        type: "select",
        ref: "part",
        required: true,
      },
      {
        key: "locationId",
        label: "Location",
        type: "select",
        ref: "location",
        required: true,
      },
      { key: "quantity", label: "Quantity", type: "number", required: true },
      { key: "projectId", label: "Project", type: "select", ref: "project" },
      { key: "taskId", label: "Task", type: "select", ref: "task" },
      { key: "poId", label: "Purchase order", type: "select", ref: "po" },
      { key: "lineId", label: "PO line", type: "select", ref: "poLine" },
      {
        key: "toLocationId",
        label: "Destination",
        type: "select",
        ref: "location",
      },
      { key: "referenceId", label: "Original movement ID" },
      {
        key: "serial",
        label: "Lot reference (register unique serials in Operations center)",
      },
      {
        key: "condition",
        label: "Receipt / return condition",
        type: "select",
        options: ["Good", "Damaged", "Quarantine"],
        default: "Good",
      },
      {
        key: "shipmentId",
        label: "Split shipment",
        type: "select",
        ref: "shipment",
      },
      {
        key: "note",
        label: "Receiving evidence / movement reason",
        type: "textarea",
        required: true,
      },
    ];
  const initial = Object.fromEntries(
    fields.map((f) => [
      f.key,
      f.default ??
        (f.type === "checkbox" ? false : f.type === "number" ? 0 : ""),
    ]),
  );
  const [values, setValues] = useState<Row>({
      ...initial,
      ...modal.defaults,
      ...modal.record,
    }),
    [localError, setLocalError] = useState("");
  const [lines, setLines] = useState<Row[]>(
    modal.record?.lines ||
      modal.defaults?.lines || [
        {
          partId: data.part?.[0]?.id || "",
          quantity: 1,
          unitCost: 0,
          confirmedETA: "",
          ackDate: "",
          leadMin: 0,
          leadMax: 0,
        },
      ],
  );
  const set = (key: string, v: any) =>
    setValues((old) => ({
      ...old,
      [key]: v,
      ...(key === "projectId" ? { taskId: "", poId: "", lineId: "" } : {}),
      ...(key === "poId" ? { lineId: "" } : {}),
      ...(key === "lineId"
        ? {
            partId:
              data.po
                ?.find((p: Row) => p.id === old.poId)
                ?.lines.find((l: Row) => l.id === v)?.partId || old.partId,
          }
        : {}),
    }));
  function options(f: Field) {
    let items: Row[] =
      f.ref === "poLine"
        ? (data.po?.find((p: Row) => p.id === values.poId)?.lines || []).map(
            (l: Row) => ({
              ...l,
              name:
                data.part?.find((p: Row) => p.id === l.partId)?.description ||
                l.partId,
            }),
          )
        : data[f.ref || ""] || [];
    if (
      [
        "task",
        "po",
        "equipment",
        "costCode",
        "shipment",
        "production",
        "change",
      ].includes(f.ref || "")
    )
      items = items.filter(
        (r) => !values.projectId || r.projectId === values.projectId,
      );
    return items;
  }
  const input = (f: Field): ReactNode => {
    if (f.type === "rows")
      return (
        <div className="repeat-fields">
          {(values[f.key] || []).map((row: Row, i: number) => (
            <div className="repeat-row" key={i}>
              {f.fields?.map((child) => (
                <label key={child.key}>
                  {child.label}
                  {child.type === "select" ? (
                    <select
                      required={child.required}
                      value={row[child.key] || ""}
                      onChange={(e) =>
                        set(
                          f.key,
                          values[f.key].map((x: Row, j: number) =>
                            j === i ? { ...x, [child.key]: e.target.value } : x,
                          ),
                        )
                      }
                    >
                      <option value="">Choose…</option>
                      {options(child).map((o) => (
                        <option key={o.id} value={o.id}>
                          {o.name || o.number || o.partNumber || o.code || o.id}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input
                      type={child.type || "text"}
                      required={child.required}
                      step="any"
                      value={row[child.key] ?? ""}
                      onChange={(e) =>
                        set(
                          f.key,
                          values[f.key].map((x: Row, j: number) =>
                            j === i
                              ? {
                                  ...x,
                                  [child.key]:
                                    child.type === "number"
                                      ? Number(e.target.value)
                                      : e.target.value,
                                }
                              : x,
                          ),
                        )
                      }
                    />
                  )}
                </label>
              ))}
              <button
                type="button"
                onClick={() =>
                  set(
                    f.key,
                    values[f.key].filter((_: Row, j: number) => j !== i),
                  )
                }
              >
                Remove row
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={() =>
              set(f.key, [
                ...(values[f.key] || []),
                Object.fromEntries(
                  (f.fields || []).map((c) => [c.key, c.default ?? ""]),
                ),
              ])
            }
          >
            Add row
          </button>
        </div>
      );
    if (f.type === "multi" || f.type === "days") {
      const choices =
        f.type === "days"
          ? [
              "Sunday",
              "Monday",
              "Tuesday",
              "Wednesday",
              "Thursday",
              "Friday",
              "Saturday",
            ].map((name, id) => ({ id, name }))
          : options(f);
      return (
        <div className="multi-options">
          {choices.map((o: any) => (
            <label className="check-label" key={o.id}>
              <input
                type="checkbox"
                checked={(values[f.key] || []).includes(o.id)}
                onChange={(e) =>
                  set(
                    f.key,
                    e.target.checked
                      ? [...(values[f.key] || []), o.id]
                      : (values[f.key] || []).filter((v: any) => v !== o.id),
                  )
                }
              />
              {o.name || o.description || o.number || o.id}
            </label>
          ))}
        </div>
      );
    }

    const v = values[f.key] ?? "",
      common = {
        id: "field-" + f.key,
        name: f.key,
        required: f.required,
        disabled:
          !!modal.record &&
          kind === "task" &&
          ["baselineStart", "baselineEnd"].includes(f.key),
      };
    if (f.type === "select")
      return (
        <select
          {...common}
          value={v}
          onChange={(e) => set(f.key, e.target.value)}
        >
          <option value="">Select…</option>
          {f.options
            ? f.options.map((o) => <option key={o}>{o}</option>)
            : options(f).map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name ||
                    o.number ||
                    o.reference ||
                    o.code ||
                    (o.partNumber
                      ? o.partNumber + " · " + o.description
                      : o.action
                        ? o.action +
                          " · " +
                          o.quantity +
                          " · " +
                          o.createdAt.slice(0, 10)
                        : o.id)}
                </option>
              ))}
        </select>
      );
    if (f.type === "checkbox")
      return (
        <input
          {...common}
          type="checkbox"
          checked={!!v}
          onChange={(e) => set(f.key, e.target.checked)}
        />
      );
    if (f.type === "textarea" || f.type === "skills")
      return (
        <textarea
          {...common}
          rows={3}
          value={
            Array.isArray(v)
              ? v
                  .map((s) => `${s.name}${s.expires ? " | " + s.expires : ""}`)
                  .join("\n")
              : v
          }
          onChange={(e) => set(f.key, e.target.value)}
        />
      );
    return (
      <input
        {...common}
        type={
          f.type === "list"
            ? "text"
            : ["signed", "optionalNumber"].includes(f.type || "")
              ? "number"
              : f.type || "text"
        }
        step={f.type === "number" ? "any" : undefined}
        min={f.type === "number" ? 0 : undefined}
        value={Array.isArray(v) ? v.join(", ") : v}
        onChange={(e) =>
          set(
            f.key,
            ["number", "signed", "optionalNumber"].includes(f.type || "")
              ? e.target.value === ""
                ? f.type === "optionalNumber"
                  ? null
                  : ""
                : Number(e.target.value)
              : e.target.value,
          )
        }
      />
    );
  };
  const visible = fields.filter(
    (f) =>
      kind !== "movement" ||
      !(
        (["poId", "lineId"].includes(f.key) &&
          !["receive", "return", "inspect"].includes(values.action)) ||
        (["taskId"].includes(f.key) &&
          !["reserve", "release", "issue", "install"].includes(
            values.action,
          )) ||
        (f.key === "toLocationId" && values.action !== "transfer") ||
        (f.key === "referenceId" && values.action !== "reverse")
      ),
  );
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        setLocalError("");
        try {
          const b = { ...values };
          for (const f of fields) {
            if (f.type === "list")
              b[f.key] = Array.isArray(b[f.key])
                ? b[f.key]
                : String(b[f.key] || "")
                    .split(",")
                    .map((s) => s.trim())
                    .filter(Boolean);
            if (f.type === "skills")
              b[f.key] = Array.isArray(b[f.key])
                ? b[f.key]
                : String(b[f.key] || "")
                    .split("\n")
                    .filter((s) => s.trim())
                    .map((s) => {
                      const [name, expires = ""] = s
                        .split("|")
                        .map((t) => t.trim());
                      return { name, expires };
                    });
          }
          if (["po", "promise", "poAmendment"].includes(kind)) b.lines = lines;
          if (kind === "user" && !b.workerId) delete b.workerId;
          if (kind === "user" && !b.supplierId) delete b.supplierId;
          if (kind === "movement" && b.action === "reverse") {
            b.quantity = modal.defaults?.quantity;
            b.partId = modal.defaults?.partId;
            b.locationId = modal.defaults?.locationId;
          }
          await onSave(b);
        } catch (e: any) {
          setLocalError(e.message);
        }
      }}
    >
      <div className="form-grid">
        {visible.map((f) => (
          <label
            className={
              ["textarea", "skills", "rows", "multi", "days"].includes(
                f.type || "",
              )
                ? "span-2"
                : f.type === "checkbox"
                  ? "check-label"
                  : ""
            }
            key={f.key}
            htmlFor={"field-" + f.key}
          >
            {f.label}
            {f.required && <span className="required"> *</span>}
            {input(f)}
            {f.help && <small>{f.help}</small>}
          </label>
        ))}
        {kind === "requirement" && modal.record && (
          <label className="span-2">
            Revision reason
            <input
              required
              minLength={5}
              value={values.reason || ""}
              onChange={(e) => set("reason", e.target.value)}
            />
          </label>
        )}
      </div>
      {["po", "promise", "poAmendment"].includes(kind) && (
        <div className="po-lines">
          <h3>
            {kind === "promise"
              ? "Supplier promises · quantities and prices are preserved"
              : "Order lines"}
          </h3>
          {lines.map((l, i) => (
            <div className="po-line" key={i}>
              <label>
                Part
                <select
                  required
                  disabled={kind === "promise" || kind === "poAmendment"}
                  value={l.partId}
                  onChange={(e) =>
                    setLines((ls) =>
                      ls.map((x, j) =>
                        j === i ? { ...x, partId: e.target.value } : x,
                      ),
                    )
                  }
                >
                  <option value="">Choose a part</option>
                  {(data.part || []).map((p: Row) => (
                    <option key={p.id} value={p.id}>
                      {p.partNumber} · {p.unit}
                    </option>
                  ))}
                </select>
              </label>
              {[
                ["quantity", "Quantity", "number"],
                ["unitCost", "Unit price", "number"],
                ["leadMin", "Min days ARO", "number"],
                ["leadMax", "Max days ARO", "number"],
                ["ackDate", "ARO start date", "date"],
                ["confirmedETA", "Confirmed ETA", "date"],
              ].map(([k, label, type]) => (
                <label key={k}>
                  {label}
                  <input
                    disabled={
                      kind === "promise" && ["quantity", "unitCost"].includes(k)
                    }
                    type={type}
                    step={type === "number" ? "any" : undefined}
                    min={0}
                    required={["quantity", "unitCost"].includes(k)}
                    value={l[k] ?? ""}
                    onChange={(e) =>
                      setLines((ls) =>
                        ls.map((x, j) =>
                          j === i
                            ? {
                                ...x,
                                [k]:
                                  type === "number"
                                    ? Number(e.target.value)
                                    : e.target.value,
                              }
                            : x,
                        ),
                      )
                    }
                  />
                </label>
              ))}
              <button
                type="button"
                aria-label={"Remove line " + (i + 1)}
                disabled={kind === "promise" || lines.length === 1}
                onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))}
              >
                <X size={16} />
              </button>
            </div>
          ))}
          <button
            type="button"
            disabled={kind === "promise" || kind === "poAmendment"}
            onClick={() =>
              setLines((ls) => [
                ...ls,
                {
                  partId: "",
                  quantity: 1,
                  unitCost: 0,
                  leadMin: 0,
                  leadMax: 0,
                  ackDate: "",
                  confirmedETA: "",
                },
              ])
            }
          >
            <Plus size={16} />
            Add line
          </button>
          <p className="muted">
            An ARO range has no forecast arrival until the supplier
            acknowledgement date is recorded.
          </p>
        </div>
      )}
      {kind === "assignment" && (
        <button
          type="button"
          onClick={async () => {
            try {
              const r = await api("/api/v1/assignments/preview", values);
              setLocalError(
                r.conflicts.length
                  ? r.conflicts.join("; ")
                  : "No scheduling conflicts found.",
              );
            } catch (e: any) {
              setLocalError(e.message);
            }
          }}
        >
          Preview capacity & skills
        </button>
      )}
      {localError && (
        <div className="message" role="status">
          {localError}
        </div>
      )}
      {kind === "plan:range" && (
        <button
          type="button"
          onClick={async () => {
            try {
              const result = await api(
                "/api/v1/planning/range-preview",
                values,
              );
              setLocalError(
                `${result.count} shifts; ${result.skipped.length} non-working days skipped. ${result.records.filter((r: Row) => r.conflicts.length).length} shifts have conflicts. ${result.records
                  .filter((r: Row) => r.conflicts.length)
                  .slice(0, 5)
                  .map((r: Row) => r.date + ": " + r.conflicts.join("; "))
                  .join(" | ")}`,
              );
            } catch (e: any) {
              setLocalError(e.message);
            }
          }}
        >
          Preview range capacity
        </button>
      )}
      <footer className="modal-actions">
        {onDelete && (
          <button
            type="button"
            disabled={busy}
            className="danger-text"
            onClick={() => {
              if (confirm("Cancel this assignment?"))
                void onDelete().catch((e) => setLocalError(e.message));
            }}
          >
            Cancel assignment
          </button>
        )}
        <button type="button" disabled={busy} onClick={onCancel}>
          Close
        </button>
        <button className="primary" disabled={busy}>
          {busy
            ? "Saving…"
            : modal.record
              ? "Save revision"
              : kind === "user"
                ? "Create account"
                : "Save record"}
          <Check size={16} />
        </button>
      </footer>
    </form>
  );
}
function ImportForm({
  project,
  data,
  onSave,
}: {
  project: string;
  data: Row;
  onSave: (b: Row) => Promise<void>;
}) {
  const [projectId, setProject] = useState(project),
    [preview, setPreview] = useState<Row[]>([]),
    [rows, setRows] = useState<Row[]>([]),
    [error, setError] = useState(""),
    [source, setSource] = useState(""),
    [sourceRows, setSourceRows] = useState<Row[]>([]),
    [mapping, setMapping] = useState<Row>({}),
    [defaultTask, setDefaultTask] = useState(""),
    [version, setVersion] = useState(""),
    [busy, setBusy] = useState(false);
  return (
    <div>
      <p>
        Import CSV, XLSX, or JSON. The first sheet/header must contain{" "}
        <code>
          partNumber, manufacturer, description, unit, quantity, taskId, source
        </code>
        . Parts and tasks must already exist. Exact aliases are matched;
        duplicates and unit mismatches block import.
      </p>
      <label>
        Project
        <select
          value={projectId}
          onChange={(e) => {
            setProject(e.target.value);
            setPreview([]);
          }}
        >
          {(data.project || []).map((p: Row) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </label>
      <div className="import-upload">
        <Upload size={26} />
        <label>
          Choose source file
          <input
            type="file"
            accept=".csv,.xlsx,.json"
            onChange={async (e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              setError("");
              setPreview([]);
              setBusy(true);
              try {
                if (file.size > 8_000_000)
                  throw new Error("Maximum file size is 8 MB");
                setSource(file.name);
                let payload: Row = { projectId };
                if (file.name.endsWith(".json")) {
                  const parsed = JSON.parse(await file.text());
                  payload.rows = Array.isArray(parsed) ? parsed : parsed.lines;
                } else {
                  const bytes = new Uint8Array(await file.arrayBuffer());
                  let binary = "";
                  for (let i = 0; i < bytes.length; i += 32768)
                    binary += String.fromCharCode(
                      ...bytes.subarray(i, i + 32768),
                    );
                  payload = {
                    ...payload,
                    base64: btoa(binary),
                    format: file.name.endsWith(".xlsx") ? "xlsx" : "csv",
                  };
                }
                const r = await api("/api/v1/imports/preview", payload);
                setRows(r.rows);
                setSourceRows(r.rows);
                setMapping(
                  Object.fromEntries(
                    [
                      "partNumber",
                      "manufacturer",
                      "description",
                      "unit",
                      "quantity",
                      "taskId",
                      "source",
                      "needBy",
                      "conversionId",
                      "changeId",
                    ].map((k) => [k, k]),
                  ),
                );
                setPreview(r.preview);
              } catch (e: any) {
                setError(e.message);
              } finally {
                setBusy(false);
              }
            }}
          />
        </label>
      </div>
      {sourceRows.length > 0 && (
        <div className="mapping">
          <h3>Map source columns</h3>
          <div className="form-grid">
            {[
              "partNumber",
              "manufacturer",
              "description",
              "unit",
              "quantity",
              "taskId",
              "source",
              "needBy",
              "conversionId",
              "changeId",
            ].map((k) => (
              <label key={k}>
                {k}
                <select
                  value={mapping[k] || ""}
                  onChange={(e) =>
                    setMapping((m) => ({ ...m, [k]: e.target.value }))
                  }
                >
                  <option value="">Not in file</option>
                  {Object.keys(sourceRows[0]).map((col) => (
                    <option key={col}>{col}</option>
                  ))}
                </select>
              </label>
            ))}
            <label>
              Default task for rows without taskId
              <select
                value={defaultTask}
                onChange={(e) => setDefaultTask(e.target.value)}
              >
                <option value="">Choose…</option>
                {(data.task || [])
                  .filter((t: Row) => t.projectId === projectId)
                  .map((t: Row) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
              </select>
            </label>
          </div>
          <button
            type="button"
            onClick={async () => {
              setError("");
              try {
                const mapped = sourceRows.map((raw) => ({
                  ...Object.fromEntries(
                    Object.entries(mapping).map(([k, col]) => [
                      k,
                      raw[col] ?? "",
                    ]),
                  ),
                  taskId: raw[mapping.taskId] || defaultTask,
                  originalSourceRow: raw,
                }));
                const r = await api("/api/v1/imports/preview", {
                  projectId,
                  rows: mapped,
                });
                setRows(mapped);
                setPreview(r.preview);
              } catch (e: any) {
                setError(e.message);
              }
            }}
          >
            Validate mapped rows
          </button>
        </div>
      )}
      <details>
        <summary>Approved unit conversions</summary>
        {(data.conversion || [])
          .filter((c: Row) => c.status === "Approved")
          .map((c: Row) => (
            <p key={c.id}>
              {data.part.find((p: Row) => p.id === c.partId)?.partNumber}: 1{" "}
              {c.fromUnit} = {c.factor} {c.toUnit}. Conversion ID:{" "}
              <code>{c.id}</code>
            </p>
          ))}
      </details>
      <details>
        <summary>Task IDs for this project</summary>
        {(data.task || [])
          .filter((t: Row) => t.projectId === projectId)
          .map((t: Row) => (
            <p key={t.id}>
              {t.name}: <code>{t.id}</code>
            </p>
          ))}
      </details>
      {error && <div className="message error">{error}</div>}
      {preview.length > 0 && (
        <>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Row</th>
                  <th>Source part</th>
                  <th>Quantity</th>
                  <th>Result</th>
                </tr>
              </thead>
              <tbody>
                {preview.map((p) => (
                  <tr key={p.index}>
                    <td>{p.index}</td>
                    <td>{p.row.partNumber}</td>
                    <td>
                      {p.row.quantity} {p.row.unit}
                    </td>
                    <td>
                      {p.errors.length ? (
                        <span className="danger-text">
                          {p.errors.join("; ")}
                        </span>
                      ) : p.existingId ? (
                        `Revise ${p.previousQuantity} → ${p.normalizedQuantity}`
                      ) : (
                        "New requirement"
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <label>
            Source revision
            <input
              required
              placeholder="Estimate revision 1"
              value={version}
              onChange={(e) => setVersion(e.target.value)}
            />
          </label>
          <p>
            Existing part/task requirements are revised, not added a second
            time. Original source rows are preserved.
          </p>
        </>
      )}
      <div className="modal-actions">
        <button
          className="primary"
          disabled={
            busy ||
            !version ||
            !preview.length ||
            preview.some((p) => p.errors.length)
          }
          onClick={async () => {
            setBusy(true);
            try {
              await onSave({
                projectId,
                rows,
                source,
                sourceVersion: version,
                reviewTokens: preview.map((p) => p.reviewToken),
              });
            } catch (e: any) {
              setError(e.message);
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? "Processing…" : "Commit reviewed import"}
        </button>
      </div>
    </div>
  );
}
function Root() {
  const [offline, setOffline] = useState(location.hash === "#offline");
  useEffect(() => {
    const changed = () => setOffline(location.hash === "#offline");
    window.addEventListener("hashchange", changed);
    return () => window.removeEventListener("hashchange", changed);
  }, []);
  return offline ? <OfflineKit /> : <App />;
}
createRoot(document.getElementById("root")!).render(<Root />);
function Evidence({
  kind,
  id,
  readOnly,
  canShare = false,
}: {
  kind: string;
  id: string;
  readOnly: boolean;
  canShare?: boolean;
}) {
  const [vendorVisible, setVendorVisible] = useState(false);
  const [files, setFiles] = useState<Row[]>([]),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const load = () =>
    api(`/api/v1/attachments?kind=${kind}&id=${id}`)
      .then(setFiles)
      .catch((e) => setError(e.message));
  useEffect(() => {
    void load();
  }, [kind, id]);
  return (
    <div className="evidence">
      <h3>Source files & receiving evidence</h3>
      {files.map((f) => (
        <a
          className="button"
          key={f.id}
          href={`${BASE}/api/v1/attachments/${f.id}`}
        >
          {f.name}
          <Download size={14} />
        </a>
      ))}
      {!files.length && <p>No files attached.</p>}
      {!readOnly && canShare && ["po", "quote", "shipment"].includes(kind) && (
        <label className="check">
          <input
            type="checkbox"
            checked={vendorVisible}
            onChange={(e) => setVendorVisible(e.target.checked)}
          />
          Share this upload with the assigned supplier account
        </label>
      )}
      {!readOnly && (
        <label>
          Add PDF or receipt photo (5 MB maximum)
          <input
            type="file"
            disabled={busy}
            accept=".pdf,.png,.jpg,.jpeg"
            onChange={async (e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              setBusy(true);
              setError("");
              try {
                if (file.size > 5_000_000) throw new Error("File exceeds 5 MB");
                const bytes = new Uint8Array(await file.arrayBuffer());
                let binary = "";
                for (let i = 0; i < bytes.length; i += 32768)
                  binary += String.fromCharCode(
                    ...bytes.subarray(i, i + 32768),
                  );
                await api("/api/v1/attachments", {
                  kind,
                  entity: id,
                  name: file.name,
                  mime: file.type,
                  base64: btoa(binary),
                  vendorVisible,
                });
                await load();
              } catch (e: any) {
                setError(e.message);
              } finally {
                setBusy(false);
              }
            }}
          />
        </label>
      )}
      {error && <div className="message error">{error}</div>}
    </div>
  );
}
