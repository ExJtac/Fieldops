import { z } from "zod";
import { randomUUID } from "node:crypto";
import { Operations } from "./domain.js";
import { type Actor, requireThat, hash } from "./store.js";
import { previewImport, commitImport } from "./imports.js";
import { schemas } from "./schemas.js";
type R = Record<string, any>;
const text = z.string().trim().min(1).max(300);
export function externalPoPreview(o: Operations, a: Actor, raw: R) {
  o.allowed(a, "po");
  const b = z
    .object({
      projectId: text,
      supplierId: text,
      number: text,
      source: text,
      sourceVersion: text,
      currency: z.enum(["USD", "CAD", "EUR", "GBP"]),
      freight: z.number().min(0),
      tax: z.number().min(0),
      rows: z.array(z.record(z.string(), z.any())).min(1).max(100),
    })
    .parse(raw);
  o.ref(a, "project", b.projectId);
  o.ref(a, "supplier", b.supplierId);
  const existing = o.all(a, "po").find((p) => p.number === b.number);
  if (existing)
    requireThat(
      existing.projectId === b.projectId &&
        existing.supplierId === b.supplierId &&
        existing.currency === b.currency,
      "Existing PO project, supplier and currency must match",
    );
  const seen = new Set<string>();
  const lines = b.rows.map((r, i) => {
    const errors: string[] = [],
      part = o.all(a, "part").find(
        (p) =>
          p.manufacturer.toLowerCase() ===
            String(r.manufacturer || "")
              .trim()
              .toLowerCase() &&
          [p.partNumber, ...p.aliases].some(
            (x: string) =>
              x.toLowerCase() ===
              String(r.partNumber || "")
                .trim()
                .toLowerCase(),
          ),
      );
    const externalLineId = String(r.externalLineId || "").trim();
    if (!externalLineId) errors.push("External line ID required");
    if (seen.has(externalLineId)) errors.push("Duplicate external line ID");
    seen.add(externalLineId);
    if (!part) errors.push("Catalog part not found");
    if (part && r.unit !== part.unit)
      errors.push(
        "Unit must match catalog; convert explicitly before PO intake",
      );
    const old =
      existing?.lines.filter((l: R) =>
        l.externalLineId
          ? l.externalLineId === externalLineId
          : l.partId === part?.id,
      ) || [];
    if (old.length > 1) errors.push("Existing PO line is ambiguous");
    const body = {
      partId: part?.id || "",
      taskId: r.taskId || old[0]?.taskId || "",
      quantity: Number(r.quantity),
      unitCost: Number(r.unitCost),
      confirmedETA: r.confirmedETA || "",
      leadMin: Number(r.leadMin || 0),
      leadMax: Number(r.leadMax || 0),
      ackDate: r.ackDate || "",
      externalLineId,
    };
    if (
      body.taskId &&
      !o
        .all(a, "task")
        .some((t) => t.id === body.taskId && t.projectId === b.projectId)
    )
      errors.push("Task must belong to this project");
    const valid = schemas.po.shape.lines.element.safeParse(body);
    if (!valid.success)
      errors.push(
        ...valid.error.issues.map((i) => i.path.join(".") + ": " + i.message),
      );
    if (body.leadMax < body.leadMin) errors.push("Invalid lead range");
    if (old[0] && body.quantity < o.receiptTotal(a, existing!.id, old[0].id))
      errors.push("Cannot reduce below received quantity");
    return {
      index: i + 1,
      original: r,
      line: { ...body, ...(old[0] ? { id: old[0].id } : {}) },
      partVersion: part?.version,
      errors,
    };
  });
  const errors: string[] = [];
  if (
    existing &&
    !["Draft", "Issued", "Acknowledged"].includes(existing.status)
  )
    errors.push(
      "Existing PO must be draft or issued; finish its current approval workflow first",
    );
  if (
    existing &&
    existing.lines.some((l: R) => !lines.some((r) => r.line.id === l.id))
  )
    errors.push("Retain every existing PO line in the revision");
  const token = hash(JSON.stringify({ b, lines, existing }));
  return {
    request: b,
    lines,
    errors,
    existingId: existing?.id,
    action: existing
      ? existing.status === "Draft"
        ? "Revise draft"
        : "Propose amendment"
      : "Create draft",
    token,
  };
}
export function externalPoCommit(o: Operations, a: Actor, raw: R) {
  const p = externalPoPreview(o, a, raw);
  requireThat(
    p.token === raw.token,
    "PO import preview changed; review again",
    409,
  );
  requireThat(
    !p.errors.length && p.lines.every((r) => !r.errors.length),
    "Resolve PO import errors",
  );
  const b = {
    ...p.request,
    lines: p.lines.map((r) => r.line),
    externalReference: p.request.source,
    source: p.request.source + " · " + p.request.sourceVersion,
    sourceVersion: p.request.sourceVersion,
  };
  let result;
  if (p.existingId) {
    const old = o.ref(a, "po", p.existingId);
    if (old.status === "Draft")
      result = o.edit(a, "po", old.id, { ...old, ...b, version: old.version });
    else
      result = o.create(a, "poAmendment", {
        projectId: old.projectId,
        poId: old.id,
        poVersion: old.version,
        reason: "Reviewed external PO import " + b.source,
        freight: b.freight,
        tax: b.tax,
        lines: b.lines.map((l: R) => ({ ...l, id: l.id || randomUUID() })),
      });
  } else result = o.create(a, "po", b);
  o.store.add(a, "import", {
    projectId: b.projectId,
    type: "external-po",
    source: b.source,
    sourceVersion: b.sourceVersion,
    poId: p.existingId || result.id,
    resultId: result.id,
    rows: p.lines.map((r) => ({ original: r.original, partId: r.line.partId })),
  });
  return { action: p.action, record: result };
}
/** Observed Bidlark lineItems/bomRevisions fields; missing units must be supplied by the reviewer. */
export function adaptEstimate(source: R) {
  const bom = source.bomSnapshot || source.bom || source,
    items = source.lineItemsSnapshot || source.lineItems || source.lines;
  requireThat(
    Array.isArray(items) && items.length > 0 && items.length <= 5000,
    "Estimate requires 1–5000 lineItems or lines",
  );
  const lines = items.map((r: R, i: number) => ({
    sourceLineId: String(r.id || i + 1),
    partNumber: r.partNumber || "",
    manufacturer: r.manufacturer || "",
    description: r.description || "",
    unit: r.unit ? String(r.unit).toLowerCase() : "",
    quantity: Number(r.quantity),
    laborHoursPerUnit: r.laborHours == null ? null : Number(r.laborHours),
    taskId: r.taskId || "",
    excluded: !!r.deletedAt || !!r.belowTheLine,
    sourceReferences: r.sourceReferences || null,
  }));
  const included = lines.filter((r) => !r.excluded),
    laborKnown = included.every(
      (r) =>
        r.laborHoursPerUnit != null &&
        Number.isFinite(r.laborHoursPerUnit) &&
        r.laborHoursPerUnit >= 0,
    );
  return {
    estimateId: String(source.bomId || bom.id || ""),
    sourceVersion: String(source.revisionNumber || source.sourceVersion || ""),
    lines,
    fieldBudget: laborKnown
      ? included.reduce((n, r) => n + r.quantity * r.laborHoursPerUnit!, 0)
      : null,
    pmBudget: bom.pmHours == null ? null : Number(bom.pmHours),
    sourceHash: hash(JSON.stringify(source)),
    notes:
      "Labor hours are per-unit in the observed Bidlark lineItems schema. Below-the-line/deleted rows are excluded from materials; review all included rows, units, task mappings and project budgets.",
  };
}
export function estimatePreview(o: Operations, a: Actor, raw: R) {
  o.allowed(a, "task");
  o.allowed(a, "requirement");
  const b = z
    .object({
      projectId: text,
      estimateId: text,
      sourceVersion: text,
      sourceHash: text,
      source: text,
      fieldBudget: z.number().min(0).max(1e9),
      pmBudget: z.number().min(0).max(1e9),
      rows: z.array(z.record(z.string(), z.any())).min(1).max(5000),
      allocations: z
        .array(z.object({ taskId: text, hours: z.number().min(0).max(1e9) }))
        .default([]),
    })
    .parse(raw);
  const project = o.ref(a, "project", b.projectId),
    rows = previewImport(o, a, b.projectId, b.rows),
    seen = new Set<string>(),
    errors: string[] = [];
  const allocations = b.allocations.map((v) => {
    const task = o.ref(a, "task", v.taskId);
    requireThat(
      task.projectId === b.projectId,
      "Task belongs to another project",
    );
    if (seen.has(task.id)) errors.push("Duplicate task allocation");
    seen.add(task.id);
    return {
      ...v,
      taskVersion: task.version,
      laborType: task.laborType,
      previousHours: task.allocatedHours,
    };
  });
  const allTasks = o.all(a, "task").filter((t) => t.projectId === project.id);
  for (const type of ["field", "pm"]) {
    const allocated = allTasks
      .filter((t) => t.laborType === type)
      .reduce(
        (n, t) =>
          n +
          (allocations.find((x) => x.taskId === t.id)?.hours ??
            t.allocatedHours ??
            0),
        0,
      );
    if (allocated > (type === "field" ? b.fieldBudget : b.pmBudget) + 1e-6)
      errors.push(type + " task allocations exceed reviewed project budget");
  }
  const prior = o
    .all(a, "estimateImport")
    .find(
      (i) =>
        i.projectId === project.id &&
        i.estimateId === b.estimateId &&
        i.sourceVersion === b.sourceVersion,
    );
  if (prior) errors.push("This estimate revision was already imported");
  return {
    request: b,
    rows,
    allocations,
    errors,
    previousBudget: { field: project.fieldBudget, pm: project.pmBudget },
    token: hash(
      JSON.stringify({
        b,
        project,
        rows,
        allocations,
        allTasks: allTasks.map((t) => [t.id, t.version, t.allocatedHours]),
      }),
    ),
  };
}
export function estimateCommit(o: Operations, a: Actor, raw: R) {
  const p = estimatePreview(o, a, raw);
  requireThat(
    raw.token === p.token,
    "Estimate review changed; preview again",
    409,
  );
  requireThat(
    !p.errors.length && p.rows.every((r) => !r.errors.length),
    "Resolve estimate review errors",
  );
  const b = p.request,
    project = o.ref(a, "project", b.projectId);
  commitImport(o, a, {
    projectId: b.projectId,
    rows: b.rows,
    source: b.source + " · estimate " + b.estimateId,
    sourceVersion: b.sourceVersion,
    reviewTokens: p.rows.map((r) => r.reviewToken),
  });
  o.edit(a, "project", project.id, {
    ...project,
    fieldBudget: b.fieldBudget,
    pmBudget: b.pmBudget,
    version: project.version,
  });
  for (const allocation of p.allocations) {
    const t = o.ref(a, "task", allocation.taskId);
    o.edit(a, "task", t.id, {
      ...t,
      allocatedHours: allocation.hours,
      version: t.version,
    });
  }
  const record = o.store.add(a, "estimateImport", {
    ...b,
    rows: p.rows.map((r) => ({
      original: r.original,
      partId: r.partId,
      taskId: r.row.taskId,
    })),
    previousBudget: p.previousBudget,
    status: "Imported",
  });
  return {
    id: record.id,
    materials: p.rows.length,
    allocations: p.allocations.length,
  };
}
