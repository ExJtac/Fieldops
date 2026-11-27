import { z } from "zod";
import { Operations, addDays, canCost } from "./domain.js";
import { type Actor, requireThat } from "./store.js";

type R = Record<string, any>;
export function materialWorkspace(o: Operations, a: Actor, projectId = "") {
  requireThat(
    !["worker", "viewer"].includes(a.role),
    "Operations staff only",
    403,
  );
  if (projectId) o.ref(a, "project", projectId);
  const snapshot = o.snapshot(a),
    d: R = snapshot.data;
  const lines = snapshot.readiness
    .filter((t: R) => !projectId || t.projectId === projectId)
    .flatMap((t: R) =>
      t.lines.map((r: R) => {
        const part = d.part.find((p: R) => p.id === r.partId),
          balance = o.balance(a, r.partId);
        const orders = d.po
          .filter((p: R) => p.projectId === r.projectId)
          .flatMap((p: R) =>
            p.lines
              .filter((l: R) => l.partId === r.partId)
              .map((l: R) => ({
                ...l,
                poId: p.id,
                number: p.number,
                supplierId: p.supplierId,
                supplier:
                  d.supplier.find((s: R) => s.id === p.supplierId)?.name ||
                  "Supplier",
                status: p.status,
                currency: p.currency,
                received: o.receiptTotal(a, p.id, l.id),
                forecastFrom: l.ackDate ? addDays(l.ackDate, l.leadMin) : "",
                forecastTo: l.ackDate ? addDays(l.ackDate, l.leadMax) : "",
              })),
          );
        const active = orders.filter((p: R) =>
          ["Issued", "Acknowledged"].includes(p.status),
        );
        const taskBalance = o.balance(a, r.partId, undefined, r.taskId);
        return {
          ...r,
          manufacturer: part.manufacturer,
          notes: part.notes,
          taskName: t.name,
          section: t.section,
          taskStatus: t.status,
          onHand: balance.onHand,
          reserved: taskBalance.reserved,
          available: balance.available,
          issued: taskBalance.issued,
          installed: taskBalance.installed,
          ordered: active.reduce((n: number, p: R) => n + p.quantity, 0),
          received: orders.reduce((n: number, p: R) => n + p.received, 0),
          orders,
          quotes: (d.quote || []).filter(
            (q: R) => q.projectId === r.projectId && q.partId === r.partId,
          ),
        };
      }),
    );
  return {
    lines,
    tasks: snapshot.readiness.filter(
      (t: R) => !projectId || t.projectId === projectId,
    ),
  };
}

export function materialTimeline(
  o: Operations,
  a: Actor,
  projectId: string,
  partId: string,
) {
  requireThat(
    !["worker", "viewer"].includes(a.role),
    "Operations staff only",
    403,
  );
  o.ref(a, "project", projectId);
  const part = o.ref(a, "part", partId);
  const related: { kind: string; record: R }[] = [];
  const kinds = [
    "requirement",
    "rfq",
    "quote",
    "po",
    "shipment",
    "movement",
    "asset",
    "substitution",
    "conversion",
    "import",
  ];
  const privateKinds = new Set(["rfq", "quote", "po", "import"]);
  for (const kind of kinds) {
    if (!canCost(a) && privateKinds.has(kind)) continue;
    for (const r of o.all(a, kind)) {
      if (r.projectId && r.projectId !== projectId) continue;
      if (
        kind === "import"
          ? !(r.rows || []).some(
              (l: R) => l.partId === partId || l.partNumber === part.partNumber,
            )
          : !(
              r.partId === partId ||
              r.originalPartId === partId ||
              r.replacementPartId === partId ||
              (r.lines || []).some(
                (l: R) =>
                  l.partId === partId ||
                  (kind === "shipment" &&
                    o
                      .ref(a, "po", r.poId)
                      .lines.some(
                        (p: R) => p.id === l.lineId && p.partId === partId,
                      )),
              )
            )
      )
        continue;
      related.push({ kind, record: r });
    }
  }
  const entries: R[] = [];
  for (const { kind, record } of related) {
    const revisions = o.store.db
      .prepare(
        "SELECT body FROM revisions WHERE org=? AND kind=? AND id=? ORDER BY version",
      )
      .all(a.org, kind, record.id) as any[];
    for (const row of revisions) {
      const r = JSON.parse(row.body);
      entries.push({
        id: `${kind}:${r.id}:${r.version}`,
        kind,
        record: r,
        at: r.updatedAt || r.createdAt,
      });
    }
    if (!revisions.length)
      entries.push({
        id: `${kind}:${record.id}`,
        kind,
        record,
        at: record.updatedAt || record.createdAt,
      });
  }
  const attachments = related
    .filter(({ kind }) => canCost(a) || !privateKinds.has(kind))
    .flatMap(({ kind, record }) =>
      (
        o.store.db
          .prepare(
            "SELECT id,name,mime,created_at FROM attachments WHERE org=? AND kind=? AND entity=?",
          )
          .all(a.org, kind, record.id) as any[]
      ).map((f) => ({ ...f, kind, entity: record.id })),
    );
  return {
    part,
    entries: entries.sort((a, b) => String(b.at).localeCompare(String(a.at))),
    attachments,
  };
}

export function compareQuotes(o: Operations, a: Actor, raw: unknown) {
  requireThat(canCost(a), "Supplier prices are restricted", 403);
  const b = z
    .object({
      projectId: z.string(),
      partId: z.string(),
      taskId: z.string().default(""),
      quantity: z.number().positive().max(1e9),
      currency: z.enum(["USD", "CAD", "EUR", "GBP"]),
    })
    .parse(raw);
  o.ref(a, "project", b.projectId);
  const part = o.ref(a, "part", b.partId);
  if (b.taskId)
    requireThat(
      o.ref(a, "task", b.taskId).projectId === b.projectId,
      "Task belongs to another project",
    );
  const substitutes = o
    .all(a, "substitution")
    .filter(
      (s) =>
        s.projectId === b.projectId &&
        s.taskId === b.taskId &&
        s.originalPartId === part.id &&
        s.status === "Approved",
    );
  const alternateIds = new Set(substitutes.map((s) => s.replacementPartId));
  const candidates = o
    .all(a, "quote")
    .filter(
      (q) =>
        q.projectId === b.projectId &&
        (q.partId === part.id || alternateIds.has(q.partId)),
    );
  const today = new Date().toISOString().slice(0, 10);
  const rows = candidates.map((q) => {
    const reasons: string[] = [];
    if (q.currency !== b.currency)
      reasons.push("Currency differs; no exchange rate assumed");
    if (q.unit !== part.unit)
      reasons.push("Unit differs; no conversion assumed");
    if (q.quantity !== b.quantity)
      reasons.push(
        "Quoted quantity differs; request a matching freight/tax quote",
      );
    if (q.validUntil && q.validUntil < today) reasons.push("Quote expired");
    if (q.status === "Rejected") reasons.push("Quote rejected");
    const tier = [...(q.tiers || [])]
      .filter((t) => t.minimum <= b.quantity)
      .sort((x, y) => y.minimum - x.minimum)[0];
    const unitCost = tier?.unitCost ?? q.unitCost;
    return {
      ...q,
      supplier: o.ref(a, "supplier", q.supplierId).name,
      partNumber: o.ref(a, "part", q.partId).partNumber,
      alternate: q.partId !== part.id,
      equivalenceId:
        substitutes.find((s) => s.replacementPartId === q.partId)?.id || "",
      effectiveUnitCost: unitCost,
      landedTotal: reasons.length
        ? null
        : Math.round((unitCost * b.quantity + q.freight + q.tax) * 100) / 100,
      reasons,
    };
  });
  return {
    criteria: { ...b, unit: part.unit },
    rows: rows.sort(
      (x, y) => (x.landedTotal ?? Infinity) - (y.landedTotal ?? Infinity),
    ),
  };
}
