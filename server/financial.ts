import { randomUUID } from "node:crypto";
import { z } from "zod";
import { type Actor, requireThat } from "./store.js";
import type { Operations } from "./domain.js";
import { payrollAccess } from "./access.js";
export function commercialAccess(o: Operations, a: Actor) {
  return !!o.store.db
    .prepare("SELECT 1 FROM commercial_access WHERE org=? AND user_id=?")
    .get(a.org, a.id);
}
export function financialView(o: Operations, a: Actor, projectId = "") {
  if (projectId) o.ref(a, "project", projectId);
  const commercial = commercialAccess(o, a),
    payroll = payrollAccess(o.store, a);
  const projects = new Set(o.all(a, "project").map((p) => p.id));
  const history = commercial
    ? (
        o.store.db
          .prepare(
            "SELECT body FROM commercial_pricing WHERE org=? ORDER BY created_at,version",
          )
          .all(a.org) as any[]
      )
        .map((x) => JSON.parse(x.body))
        .filter(
          (r) =>
            projects.has(r.projectId) &&
            (!projectId || r.projectId === projectId),
        )
    : [];
  const latest = new Map<string, any>();
  for (const r of history) latest.set(r.id, r);
  const workers = new Set(o.all(a, "worker").map((w) => w.id));
  return {
    commercial,
    payroll,
    prices: [...latest.values()],
    rates: payroll
      ? (
          o.store.db
            .prepare("SELECT * FROM labor_rates WHERE org=?")
            .all(a.org) as any[]
        ).filter((r) => workers.has(r.worker_id))
      : [],
    priceHistory: history,
    rateHistory: payroll
      ? (
          o.store.db
            .prepare(
              "SELECT * FROM labor_rate_history WHERE org=? ORDER BY created_at DESC,rowid DESC",
            )
            .all(a.org) as any[]
        )
          .filter((r) => workers.has(r.worker_id))
          .map((r) => ({
            ...r,
            before: r.before_body ? JSON.parse(r.before_body) : null,
            after: JSON.parse(r.after_body),
            before_body: undefined,
            after_body: undefined,
          }))
      : [],
  };
}
export function savePrice(o: Operations, a: Actor, raw: any, approve = false) {
  requireThat(
    commercialAccess(o, a),
    "Explicit customer-pricing permission required",
    403,
  );
  const id = raw.id ? z.string().parse(raw.id) : randomUUID(),
    oldRow = o.store.db
      .prepare(
        "SELECT body FROM commercial_pricing WHERE org=? AND id=? ORDER BY version DESC LIMIT 1",
      )
      .get(a.org, id) as any,
    old = oldRow ? JSON.parse(oldRow.body) : null;
  if (raw.id) requireThat(old, "Customer price not found", 404);
  if (old) {
    o.ref(a, "project", old.projectId);
    requireThat(
      raw.version === old.version,
      "Customer price changed; reload",
      409,
    );
  }
  let record;
  if (approve) {
    requireThat(
      old?.status === "Draft",
      "Only draft customer prices can be approved",
    );
    o.separation(a, { ...old, createdBy: old.updatedBy || old.createdBy });
    record = { ...old, status: "Approved", approvedBy: a.id };
  } else {
    const b = z
      .object({
        projectId: z.string(),
        taskId: z.string().default(""),
        description: z.string().trim().min(1).max(300),
        quantity: z.number().positive().max(1e9),
        unit: z.enum(["ea", "ft", "m", "box", "roll", "hr"]),
        currency: z.enum(["USD", "CAD", "EUR", "GBP"]),
        method: z.enum(["price", "markup"]),
        unitSell: z.number().min(0).max(1e9),
        costBasis: z.number().min(0).max(1e9),
        markupPercent: z.number().min(-100).max(1000),
        reason: z.string().trim().min(5).max(3000),
      })
      .parse(raw);
    o.ref(a, "project", b.projectId);
    if (b.taskId)
      requireThat(
        o.ref(a, "task", b.taskId).projectId === b.projectId,
        "Task belongs to another project",
      );
    if (old)
      requireThat(old.projectId === b.projectId, "Price project cannot change");
    const unitSell =
      b.method === "markup"
        ? Math.round(b.costBasis * (1 + b.markupPercent / 100) * 100) / 100
        : b.unitSell;
    record = {
      ...b,
      unitSell,
      total: Math.round(unitSell * b.quantity * 100) / 100,
      status: "Draft",
      createdBy: old?.createdBy || a.id,
    };
  }
  record = {
    ...record,
    id,
    version: (old?.version || 0) + 1,
    updatedAt: new Date().toISOString(),
    updatedBy: a.id,
  };
  o.store.db
    .prepare("INSERT INTO commercial_pricing VALUES(?,?,?,?,?,?,?)")
    .run(
      a.org,
      id,
      record.version,
      record.projectId,
      JSON.stringify(record),
      record.updatedAt,
      a.id,
    );
  o.store.audit(
    a,
    approve ? "customer_price.approved" : "customer_price.revised",
    id,
    { projectId: record.projectId, version: record.version },
  );
  return record;
}
