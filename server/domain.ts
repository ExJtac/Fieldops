import { guardEntitlement } from "./tenants.js";
import { vendorWorkspace } from "./vendor.js";
import { effectiveCrew, effectiveCalendar, crewName } from "./crews.js";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  Store,
  type Actor,
  type Role,
  type RecordData as R,
  requireThat,
  hash,
} from "./store.js";
import { validateExtra } from "./extensions-validation.js";
import { projectAccess, filterRecords, projectIds } from "./access.js";
import { schemas, type Kind, date, qty } from "./schemas.js";
const permissions: Record<string, Role[]> = {
  conversion: ["admin", "purchasing"],
  poAmendment: ["admin", "purchasing"],
  credit: ["admin", "purchasing"],
  shipment: ["admin", "purchasing", "vendor"],
  asset: ["admin", "purchasing", "foreman"],
  adjustment: ["admin", "purchasing", "foreman"],
  crewTemplate: ["admin", "pm"],
  crew: ["admin", "pm"],
  crewMembership: ["admin", "pm"],
  calendar: ["admin", "pm"],
  equipment: ["admin", "pm"],
  scheduleRevision: ["admin", "pm"],
  checkin: ["admin", "pm", "foreman", "worker"],
  costCode: ["admin", "pm"],
  notice: ["admin", "pm"],
  productionCorrection: ["admin", "pm", "foreman"],
  retention: ["admin"],
  project: ["admin", "pm"],
  task: ["admin", "pm"],
  part: ["admin", "purchasing"],
  supplier: ["admin", "purchasing"],
  location: ["admin", "purchasing"],
  requirement: ["admin", "pm", "purchasing"],
  quote: ["admin", "purchasing", "vendor"],
  rfq: ["admin", "purchasing"],
  po: ["admin", "purchasing"],
  worker: ["admin", "pm"],
  leave: ["admin", "pm"],
  assignment: ["admin", "pm"],
  time: ["admin", "pm", "foreman", "worker"],
  production: ["admin", "pm", "foreman", "worker"],
  availability: ["admin", "pm", "worker"],
  reforecast: ["admin", "pm"],
  hold: ["admin", "pm"],
  substitution: ["admin", "pm", "purchasing"],
  change: ["admin", "pm"],
};
export const canCost = (a: Actor) => ["admin", "purchasing"].includes(a.role);
export const addDays = (d: string, n: number) =>
  new Date(Date.parse(d + "T00:00:00Z") + n * 86400000)
    .toISOString()
    .slice(0, 10);
export function capacity(project: R, worker: R, day: string, leaves: R[]) {
  return !worker.active ||
    !project.workdays.includes(new Date(day + "T00:00:00Z").getUTCDay()) ||
    project.holidays.includes(day)
    ? 0
    : Math.max(
        0,
        worker.dailyHours -
          leaves
            .filter((l) => l.workerId === worker.id && l.date === day)
            .reduce((s, l) => s + l.hours, 0),
      );
}
export class Operations {
  constructor(public store: Store) {}
  allowed(a: Actor, action: string) {
    requireThat(
      (permissions[action] || ["admin"]).includes(a.role),
      "Your role cannot perform this action",
      403,
    );
  }
  ref(a: Actor, kind: string, id: string) {
    const r = this.store.get(a.org, kind, id);
    if (a.role === "vendor")
      requireThat(
        filterRecords(this.store, a, kind, [r]).length > 0,
        "Supplier record access denied",
        403,
      );
    if (kind === "availability")
      requireThat(
        ["admin", "pm", "worker"].includes(a.role),
        "Availability details are restricted",
        403,
      );
    if (
      ["worker", "calendar", "leave", "crewMembership"].includes(kind) &&
      !["admin", "pm"].includes(a.role)
    )
      requireThat(
        filterRecords(this.store, a, kind, [r]).length > 0,
        "Worker record access denied",
        403,
      );
    if (kind === "project") projectAccess(this.store, a, r.id);
    else if (r.projectId) projectAccess(this.store, a, r.projectId);
    if (
      a.role === "worker" &&
      ["time", "timer", "checkin", "production", "availability"].includes(kind)
    )
      requireThat(r.workerId === a.workerId, "Own records only", 403);
    return r;
  }
  all(a: Actor, kind: string) {
    return filterRecords(this.store, a, kind, this.store.list(a.org, kind));
  }
  write<T>(a: Actor, key: string, payload: any, fn: () => T): T {
    requireThat(
      typeof key === "string" && key.length >= 8 && key.length <= 200,
      "An idempotency key is required",
    );
    return this.store.tx(() => {
      const digest = hash(JSON.stringify({ actor: a.id, payload }));
      const prior = this.store.db
        .prepare("SELECT * FROM requests WHERE org=? AND key=?")
        .get(a.org, key) as any;
      if (prior) {
        requireThat(
          prior.hash === digest,
          "Idempotency key already used for a different request",
          409,
        );
        return JSON.parse(prior.result);
      }
      const before = (
        this.store.db
          .prepare("SELECT coalesce(max(rowid),0) AS n FROM outbox WHERE org=?")
          .get(a.org) as any
      ).n;
      const result = fn();
      const changed = this.store.db
        .prepare("SELECT kind FROM outbox WHERE org=? AND rowid>?")
        .all(a.org, before) as any[];
      if (
        changed.some((e) =>
          [
            "task",
            "requirement",
            "movement",
            "substitution",
            "hold",
            "po",
            "time",
            "production",
            "assignment",
          ].includes(e.kind),
        )
      ) {
        const system: Actor = { ...a, role: "admin", supplierId: undefined };
        const forecasts = this.forecast(system);
        for (const readiness of this.readiness(system)) {
          const progress = forecasts.find((f) => f.taskId === readiness.taskId),
            payload = {
              projectId: readiness.projectId,
              taskId: readiness.taskId,
              materialStatus: readiness.status,
              progress: progress?.progress ?? null,
              approvedQuantity: progress?.installed ?? 0,
              actualHours: progress?.actual ?? 0,
              plannedHours: progress?.planned ?? 0,
              baselineStart: readiness.baselineStart,
              baselineEnd: readiness.baselineEnd,
            };
          const digest = hash(JSON.stringify(payload)),
            old = this.store.db
              .prepare(
                "SELECT * FROM task_material_state WHERE org=? AND task_id=?",
              )
              .get(a.org, readiness.taskId) as any;
          if (old?.status !== readiness.status && old) {
            this.store.emit(
              a,
              "readiness",
              readiness.taskId,
              readiness.status === "Ready"
                ? "TaskMaterialsBecameReady"
                : "TaskMaterialReadinessChanged",
              payload,
            );
          }
          if (old?.digest !== digest) {
            this.store.emit(
              a,
              "progress",
              readiness.taskId,
              "ProjectProgressChanged",
              payload,
            );
            this.store.db
              .prepare(
                "INSERT INTO task_material_state VALUES(?,?,?,?) ON CONFLICT(org,task_id) DO UPDATE SET status=excluded.status,digest=excluded.digest",
              )
              .run(a.org, readiness.taskId, readiness.status, digest);
          }
        }
      }
      this.store.db
        .prepare("INSERT INTO requests VALUES(?,?,?,?)")
        .run(a.org, key, digest, JSON.stringify(result));
      return result;
    });
  }
  validateRefs(a: Actor, b: any) {
    if (b.projectId) this.ref(a, "project", b.projectId);
    if (b.taskId) {
      const t = this.ref(a, "task", b.taskId);
      requireThat(
        t.projectId === b.projectId,
        "Task belongs to another project",
      );
    }
    for (const k of ["part", "supplier", "worker"])
      if (b[k + "Id"]) this.ref(a, k, b[k + "Id"]);
  }
  create(a: Actor, kind: Kind, raw: unknown) {
    this.allowed(a, kind);
    guardEntitlement(this.store, a, kind);
    requireThat(kind in schemas, "Unknown record type");
    const b: any = schemas[kind].parse(raw);
    this.validateRefs(a, b);
    validateExtra(this, a, kind, b);
    if (kind === "part") {
      const candidates = [b.partNumber, ...b.aliases].map((s: string) =>
        s.toLowerCase(),
      );
      requireThat(
        new Set(candidates).size === candidates.length,
        "Duplicate part aliases",
      );
      const existing = this.all(a, "part");
      requireThat(
        !existing.some(
          (p) =>
            p.manufacturer.toLowerCase() === b.manufacturer.toLowerCase() &&
            [p.partNumber, ...p.aliases].some((v: string) =>
              candidates.includes(v.toLowerCase()),
            ),
        ),
        "Part number or alias already exists for this manufacturer",
      );
    }
    if (kind === "requirement") {
      const p = this.ref(a, "part", b.partId);
      b.unit = p.unit;
      requireThat(
        !this.all(a, "requirement").some(
          (r) => r.taskId === b.taskId && r.partId === b.partId,
        ),
        "Requirement exists. Revise its quantity instead of duplicating it",
      );
    }
    if (kind === "quote")
      requireThat(
        this.ref(a, "part", b.partId).unit === b.unit,
        "Quote unit does not match catalog unit",
      );
    if (kind === "po") {
      requireThat(
        !this.store.list(a.org, "po").some((p) => p.number === b.number),
        "PO number already exists",
      );
      b.status = "Draft";
      b.lines = b.lines.map((l: any) => {
        this.ref(a, "part", l.partId);
        if (l.taskId)
          requireThat(
            this.ref(a, "task", l.taskId).projectId === b.projectId,
            "PO line task belongs to another project",
          );
        requireThat(l.leadMax >= l.leadMin, "Invalid lead-time range");
        return { ...l, id: randomUUID() };
      });
    }
    if (kind === "rfq") b.status = "Draft";
    if (kind === "assignment") {
      const conflicts = this.assignmentConflicts(a, b);
      requireThat(
        !conflicts.length || b.override.trim().length >= 10,
        conflicts.join("; "),
        409,
      );
      b.conflicts = conflicts;
      if (conflicts.length)
        this.store.audit(a, "assignment.override", b.workerId, {
          reason: b.override,
          conflicts,
        });
    }
    if (kind === "time") {
      if (a.role === "worker") {
        requireThat(
          a.workerId === b.workerId,
          "You can only enter your own time",
          403,
        );
        requireThat(
          this.all(a, "assignment").some(
            (x) =>
              x.workerId === a.workerId &&
              x.projectId === b.projectId &&
              x.status !== "Cancelled",
          ),
          "You are not assigned to this project",
          403,
        );
      }
      this.timeConflicts(a, b);
      b.crewAtEntry = crewName(this.store, a, b.workerId, b.date);
      b.workerReviewed = a.workerId === b.workerId;
      b.reviewedByWorker = b.workerReviewed ? a.id : null;
      b.status = "Draft";
    }
    if (kind === "leave")
      requireThat(
        !this.store
          .list(a.org, "leave")
          .some((l) => l.workerId === b.workerId && l.date === b.date),
        "Leave already recorded on this date",
      );
    if (kind === "production") {
      if (a.role === "worker")
        requireThat(
          b.workerId === a.workerId &&
            this.all(a, "assignment").some(
              (x) =>
                x.workerId === a.workerId &&
                x.taskId === b.taskId &&
                x.date === b.date &&
                x.status !== "Cancelled",
            ),
          "Own assigned task and date required",
          403,
        );
      if (b.timeId) {
        const time = this.ref(a, "time", b.timeId);
        requireThat(
          time.workerId === b.workerId &&
            time.projectId === b.projectId &&
            time.taskId === b.taskId &&
            time.date === b.date,
          "Production must match the linked timecard",
        );
        requireThat(
          !this.all(a, "production").some(
            (p) => p.timeId === b.timeId && p.status !== "Rejected",
          ),
          "Timecard already has a production record",
          409,
        );
      }
      b.crewAtEntry = b.workerId
        ? crewName(this.store, a, b.workerId, b.date)
        : "";
      const t = this.ref(a, "task", b.taskId);
      requireThat(
        t.unit === b.unit,
        "Production unit does not match task unit",
      );
      b.status = "Submitted";
    }
    if (["reforecast", "substitution", "hold", "change"].includes(kind))
      b.status = "Proposed";
    if (kind === "substitution") {
      requireThat(
        !this.all(a, "substitution").some(
          (s) =>
            s.taskId === b.taskId &&
            s.replacementPartId === b.replacementPartId &&
            s.status !== "Rejected",
        ),
        "This replacement already supports a requirement on the task",
      );
      requireThat(
        !this.all(a, "requirement").some(
          (r) => r.taskId === b.taskId && r.partId === b.replacementPartId,
        ),
        "A part with its own task requirement cannot also cover another requirement",
      );
      const p = this.ref(a, "part", b.originalPartId),
        r = this.ref(a, "part", b.replacementPartId);
      requireThat(
        p.id !== r.id && p.unit === r.unit,
        "Substitutes must be different parts with matching units",
      );
    }
    const saved = this.store.add(a, kind, b);
    if (kind === "project" && a.role !== "admin")
      this.store.db
        .prepare("INSERT OR IGNORE INTO project_access VALUES(?,?,?)")
        .run(a.org, a.id, saved.id);
    return saved;
  }
  edit(a: Actor, kind: Kind, id: string, raw: any) {
    this.allowed(a, kind);
    guardEntitlement(this.store, a, kind === "project" ? "project-edit" : kind);
    const old = this.ref(a, kind, id);
    requireThat(
      [
        "project",
        "task",
        "part",
        "supplier",
        "location",
        "requirement",
        "worker",
        "po",
        "time",
        "calendar",
        "crewTemplate",
        "crew",
        "equipment",
        "costCode",
      ].includes(kind),
      "Use a correction or a new proposal for this record",
    );
    const b: any = schemas[kind].parse({ ...old, ...raw });
    this.validateRefs(a, b);
    if (kind === "task") {
      const installed = this.all(a, "production")
        .filter((p) => p.taskId === id && p.status === "Approved")
        .reduce((sum, p) => sum + p.quantity, 0);
      requireThat(
        b.target >= installed,
        "Task quantity cannot be less than approved production",
      );
      requireThat(
        b.projectId === old.projectId && b.unit === old.unit,
        "Task project and unit cannot change",
      );
      requireThat(
        b.baselineStart === old.baselineStart &&
          b.baselineEnd === old.baselineEnd,
        "Baseline dates are immutable. Propose a schedule hold instead",
      );
    }
    if (kind === "part") {
      requireThat(
        b.unit === old.unit &&
          b.partNumber === old.partNumber &&
          b.manufacturer === old.manufacturer &&
          JSON.stringify(b.aliases) === JSON.stringify(old.aliases),
        "Catalog identity, aliases and units cannot change after creation",
      );
    }
    if (kind === "requirement") {
      requireThat(
        b.taskId === old.taskId &&
          b.partId === old.partId &&
          b.projectId === old.projectId,
        "Requirement identity cannot change",
      );
      requireThat(
        raw.reason?.trim().length >= 5,
        "A revision reason is required",
      );
      this.store.audit(a, "bom.revised", id, {
        before: old.quantity,
        after: b.quantity,
        reason: raw.reason,
      });
    }
    if (kind === "po") {
      requireThat(
        old.status === "Draft",
        "Only draft POs can be edited. Propose an approved PO amendment for issued orders",
      );
      requireThat(
        b.projectId === old.projectId && b.number === old.number,
        "PO project and number cannot change",
      );
      b.lines = b.lines.map((l: any, i: number) => {
        this.ref(a, "part", l.partId);
        if (l.taskId)
          requireThat(
            this.ref(a, "task", l.taskId).projectId === b.projectId,
            "PO line task belongs to another project",
          );
        requireThat(l.leadMax >= l.leadMin, "Invalid lead time");
        return {
          ...l,
          id:
            (l.externalLineId
              ? old.lines.find((x: R) => x.externalLineId === l.externalLineId)
                  ?.id
              : old.lines[i]?.id) || randomUUID(),
        };
      });
    }
    if (kind === "time") {
      if (
        this.all(a, "production").some(
          (p) => p.timeId === old.id && p.status !== "Rejected",
        )
      )
        requireThat(
          b.workerId === old.workerId &&
            b.taskId === old.taskId &&
            b.projectId === old.projectId &&
            b.date === old.date,
          "Linked production fixes the timecard worker, task and date; reject or correct production first",
          409,
        );
      requireThat(
        ["Draft", "Rejected"].includes(old.status),
        "Request a correction before editing approved time",
      );
      if (a.role === "worker")
        requireThat(
          a.workerId === old.workerId && a.workerId === b.workerId,
          "You can only edit your own time",
          403,
        );
      validateExtra(this, a, kind, b);
      this.timeConflicts(a, b, id);
      b.status = "Draft";
      b.workerReviewed = false;
      b.reviewedByWorker = null;
    }
    if (["part", "equipment", "crewTemplate"].includes(kind))
      validateExtra(this, a, kind, b);
    if (kind === "equipment")
      requireThat(
        b.projectId === old.projectId,
        "Equipment project cannot change",
      );
    if (kind === "costCode")
      requireThat(
        b.projectId === old.projectId &&
          b.code === old.code &&
          b.laborType === old.laborType,
        "Cost code identity cannot change after creation",
      );
    if (kind === "calendar")
      requireThat(b.workerId === old.workerId, "Calendar worker cannot change");
    if (kind === "task") {
      validateExtra(this, a, kind, b);
      const visit = (id: string, seen: Set<string>): void => {
        requireThat(!seen.has(id), "Dependency cycle");
        const next = new Set(seen).add(id);
        for (const d of id === old.id
          ? b.dependencies
          : this.ref(a, "task", id).dependencies || [])
          visit(d, next);
      };
      visit(old.id, new Set());
    }
    return this.store.update(
      a,
      kind,
      id,
      b,
      z.number().int().positive().parse(raw.version),
    );
  }
  transition(a: Actor, kind: string, id: string, raw: any) {
    guardEntitlement(this.store, a, kind);
    const r = this.ref(a, kind, id),
      status = z.string().parse(raw.status);
    let allowed: string[] = [];
    if (kind === "po") {
      this.allowed(a, "po");
      const map: Record<string, string[]> = {
        Draft: ["Submitted"],
        Submitted: ["Approved", "Draft"],
        Approved: ["Issued", "Cancelled"],
        Issued: ["Acknowledged", "Cancelled"],
        Acknowledged: ["Cancelled"],
      };
      allowed = map[r.status] || [];
      if (status === "Approved")
        requireThat(
          a.role === "admin",
          "An administrator must approve purchases",
          403,
        );
      if (status === "Approved") this.separation(a, r);
    } else if (kind === "time") {
      this.allowed(a, "time");
      if (a.role === "worker")
        requireThat(
          a.workerId === r.workerId,
          "You can only manage your own time",
          403,
        );
      const map: Record<string, string[]> = {
        Draft: ["Submitted"],
        Submitted: ["Approved", "Rejected"],
        Approved: ["Locked", "Correction requested"],
        Locked: ["Correction requested"],
        "Correction requested": ["Rejected"],
      };
      allowed = map[r.status] || [];
      if (["Approved", "Rejected", "Locked"].includes(status)) {
        requireThat(
          ["admin", "pm"].includes(a.role),
          "A project manager must review time",
          403,
        );
        if (status === "Approved") {
          this.separation(a, r);
          const linked = this.store.db
            .prepare(
              "SELECT u.id FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.org=? AND m.worker_id=? AND m.active=1 AND u.active=1",
            )
            .all(a.org, r.workerId);
          if (linked.length)
            requireThat(
              r.workerReviewed,
              "Worker must review submitted hours before approval",
            );
        }
      }
      if (status === "Submitted") this.timeConflicts(a, r, r.id);
      if (status === "Rejected" || status === "Correction requested")
        requireThat(
          raw.reason?.trim().length >= 5,
          "Provide a correction/rejection reason",
        );
    } else if (kind === "production") {
      requireThat(
        ["admin", "pm"].includes(a.role),
        "A project manager must approve production",
        403,
      );
      allowed = r.status === "Submitted" ? ["Approved", "Rejected"] : [];
      if (status === "Approved") {
        const t = this.ref(a, "task", r.taskId);
        const actual = this.all(a, "production")
          .filter((p) => p.taskId === r.taskId && p.status === "Approved")
          .reduce((s, p) => s + p.quantity, 0);
        requireThat(
          !t.target || actual + r.quantity <= t.target,
          "Production exceeds the approved task quantity. Revise scope first",
        );
        this.separation(a, r);
      }
    } else if (
      ["hold", "reforecast", "substitution", "change"].includes(kind)
    ) {
      requireThat(
        ["admin", "pm"].includes(a.role),
        "A project manager must approve this proposal",
        403,
      );
      allowed =
        r.status === "Proposed"
          ? ["Approved", "Rejected"]
          : r.status === "Approved" && kind === "hold"
            ? ["Resolved"]
            : [];
    } else if (kind === "rfq") {
      this.allowed(a, "rfq");
      allowed = r.status === "Draft" ? ["Recorded"] : [];
    }
    requireThat(allowed.includes(status), "Invalid workflow transition");
    if (
      kind === "time" &&
      status === "Submitted" &&
      a.workerId === r.workerId
    ) {
      r.workerReviewed = true;
    }
    this.store.audit(
      a,
      kind + "." + status.toLowerCase().replaceAll(" ", "_"),
      id,
      { reason: raw.reason || "", from: r.status },
    );
    return this.store.update(
      a,
      kind,
      id,
      {
        status,
        reviewedBy: a.id,
        reviewReason: raw.reason || "",
        ...(kind === "time" && a.workerId === r.workerId
          ? { workerReviewed: true, reviewedByWorker: a.id }
          : {}),
      },
      z.number().int().parse(raw.version),
    );
  }
  separation(a: Actor, r: R) {
    const settings = this.all(a, "settings")[0];
    if (settings?.separation)
      requireThat(
        r.createdBy !== a.id && !(r.workerId && r.workerId === a.workerId),
        "A different authorized person must approve this action",
        403,
      );
  }
  balance(a: Actor, partId: string, locationId?: string, taskId?: string) {
    const ms = this.store
      .list(a.org, "movement")
      .filter(
        (m) =>
          m.partId === partId &&
          (!locationId || m.locationId === locationId) &&
          (!taskId || m.taskId === taskId),
      );
    const sum = (k: string) =>
      Math.round(ms.reduce((s, m) => s + (m[k] || 0), 0) * 1e6) / 1e6;
    return {
      onHand: sum("stock"),
      reserved: sum("reserved"),
      available: sum("stock") - sum("reserved"),
      issued: sum("issued"),
      installed: sum("installed"),
    };
  }
  receiptTotal(a: Actor, poId: string, lineId: string) {
    return this.all(a, "movement")
      .filter((m) => m.poId === poId && m.lineId === lineId)
      .reduce((s, m) => s + (m.received || 0), 0);
  }
  movement(a: Actor, raw: any, assetId = "") {
    guardEntitlement(this.store, a, "movement");
    requireThat(
      ["admin", "purchasing", "foreman"].includes(a.role),
      "Your role cannot move inventory",
      403,
    );
    const b = z
      .object({
        action: z.enum([
          "receive",
          "inspect",
          "reserve",
          "release",
          "issue",
          "install",
          "return",
          "transfer",
          "reverse",
        ]),
        partId: z.string(),
        locationId: z.string(),
        quantity: qty,
        projectId: z.string().default(""),
        taskId: z.string().default(""),
        poId: z.string().default(""),
        lineId: z.string().default(""),
        toLocationId: z.string().default(""),
        referenceId: z.string().default(""),
        note: z.string().min(3).max(3000),
        serial: z.string().max(300).default(""),
        shipmentId: z.string().default(""),
        condition: z.enum(["Good", "Damaged", "Quarantine"]).default("Good"),
      })
      .parse(raw);
    this.ref(a, "part", b.partId);
    this.ref(a, "location", b.locationId);
    this.validateRefs(a, b);
    const bal = this.balance(a, b.partId, b.locationId),
      taskBal = this.balance(a, b.partId, b.locationId, b.taskId);
    const q = b.quantity;
    const assets = this.store
      .list(a.org, "asset")
      .filter((x) => x.partId === b.partId && x.locationId === b.locationId);
    if (!assetId && assets.length) {
      const count = (state: string, task = false) =>
        assets.filter(
          (x) => x.status === state && (!task || x.taskId === b.taskId),
        ).length;
      if (
        ["reserve", "transfer", "return"].includes(b.action) &&
        b.condition === "Good"
      )
        requireThat(
          q <= bal.available - count("Received") + 1e-6,
          "Move serialized units through asset custody",
        );
      if (["release", "issue"].includes(b.action))
        requireThat(
          q <= taskBal.reserved - count("Reserved", true) + 1e-6,
          "Move serialized reservations through asset custody",
        );
      if (b.action === "install")
        requireThat(
          q <= taskBal.issued - count("Issued", true) + 1e-6,
          "Install serialized units through asset custody",
        );
    }
    if (b.shipmentId) {
      const shipment = this.ref(a, "shipment", b.shipmentId);
      requireThat(
        b.action === "receive" &&
          shipment.poId === b.poId &&
          shipment.status !== "Cancelled",
        "Receipt shipment must match PO",
      );
      const line = shipment.lines.find((l: any) => l.lineId === b.lineId);
      const received = this.all(a, "movement")
        .filter((m) => m.shipmentId === shipment.id && m.lineId === b.lineId)
        .reduce((s, m) => s + m.received, 0);
      requireThat(
        line && received + q <= line.quantity + 1e-6,
        "Receipt exceeds shipment quantity",
      );
    }

    let delta: any = {
      stock: 0,
      reserved: 0,
      issued: 0,
      installed: 0,
      received: 0,
      quarantined: 0,
    };
    if (["receive", "return", "inspect"].includes(b.action)) {
      const po = this.ref(a, "po", b.poId);
      delta.poVersion = po.version;
      const line = po.lines.find((l: any) => l.id === b.lineId);
      requireThat(
        line && line.partId === b.partId,
        "PO line and part do not match",
      );
      requireThat(
        b.projectId === po.projectId,
        "Receipt project must match PO",
      );
      const received = this.receiptTotal(a, po.id, line.id);
      if (b.action === "receive") {
        requireThat(
          ["Issued", "Acknowledged"].includes(po.status),
          "Issue the PO before receiving stock",
        );
        requireThat(
          received + q <= line.quantity + 1e-6,
          "Receipt exceeds remaining PO quantity",
        );
        delta.stock = b.condition === "Good" ? q : 0;
        delta.quarantined = b.condition === "Good" ? 0 : q;
        delta.received = q;
      } else if (b.action === "inspect") {
        const held = this.store
          .list(a.org, "movement")
          .filter(
            (m) =>
              m.poId === po.id &&
              m.lineId === line.id &&
              m.locationId === b.locationId,
          )
          .reduce((n, m) => n + (m.quarantined || 0), 0);
        requireThat(q <= held, "Inspection release exceeds quarantined stock");
        delta.stock = q;
        delta.quarantined = -q;
      } else {
        const held = this.store
          .list(a.org, "movement")
          .filter(
            (m) =>
              m.poId === po.id &&
              m.lineId === line.id &&
              m.locationId === b.locationId,
          )
          .reduce((n, m) => n + (m.quarantined || 0), 0);
        requireThat(
          q <= received && q <= (b.condition === "Good" ? bal.available : held),
          "Cannot return reserved, issued, or unreceived stock",
        );
        delta.stock = b.condition === "Good" ? -q : 0;
        delta.quarantined = b.condition === "Good" ? 0 : -q;
        delta.received = -q;
      }
    }
    if (["reserve", "release", "issue", "install"].includes(b.action)) {
      requireThat(b.taskId && b.projectId, "Project and task are required");
      if (b.action === "reserve") {
        requireThat(
          q <= bal.available + 1e-6,
          "Insufficient unreserved stock",
          409,
        );
        delta.reserved = q;
      }
      if (b.action === "release") {
        requireThat(
          q <= taskBal.reserved + 1e-6,
          "Release exceeds this task’s reservation",
        );
        delta.reserved = -q;
      }
      if (b.action === "issue") {
        requireThat(
          q <= taskBal.reserved + 1e-6,
          "Issue only stock reserved to this task",
        );
        delta.stock = -q;
        delta.reserved = -q;
        delta.issued = q;
      }
      if (b.action === "install") {
        requireThat(
          q <= taskBal.issued + 1e-6,
          "Installed quantity exceeds stock issued to this task",
        );
        delta.issued = -q;
        delta.installed = q;
      }
    }
    if (b.action === "transfer") {
      requireThat(
        b.toLocationId !== b.locationId,
        "Choose a different destination",
      );
      this.ref(a, "location", b.toLocationId);
      requireThat(
        q <= bal.available + 1e-6,
        "Only available stock can be transferred",
      );
      delta.stock = -q;
    }
    if (b.action === "reverse") {
      requireThat(
        a.role === "admin",
        "An administrator must reverse inventory",
        403,
      );
      const original = this.ref(a, "movement", b.referenceId);
      requireThat(
        !original.assetId &&
          !this.store
            .list(a.org, "asset")
            .some((x) => x.receiptId === original.id),
        "Serialized custody cannot be reversed as bulk stock",
      );
      requireThat(
        !this.all(a, "credit").some(
          (c) => c.returnMovementId === original.id && c.status !== "Rejected",
        ),
        "A credit references this return; resolve the credit before reversal",
      );
      requireThat(
        !["reverse", "transfer", "transfer-in"].includes(original.action),
        "Reverse the underlying non-transfer movement; use a return transfer for transfers",
      );
      requireThat(
        !this.all(a, "movement").some(
          (m) => m.referenceId === original.id && m.action === "reverse",
        ),
        "Already reversed",
      );
      requireThat(
        original.partId === b.partId &&
          original.locationId === b.locationId &&
          original.quantity === q,
        "Reversal must exactly match original movement",
      );
      Object.assign(b, {
        projectId: original.projectId,
        taskId: original.taskId,
        poId: original.poId,
        lineId: original.lineId,
      });
      delta = Object.fromEntries(
        [
          "stock",
          "reserved",
          "issued",
          "installed",
          "received",
          "quarantined",
        ].map((k) => [k, -(original[k] || 0)]),
      );
      const quarantine = this.store
        .list(a.org, "movement")
        .filter((m) => m.partId === b.partId && m.locationId === b.locationId)
        .reduce((n, m) => n + (m.quarantined || 0), 0);
      requireThat(
        quarantine + (delta.quarantined || 0) >= 0,
        "Reverse quarantine-dependent movements first",
      );
      if (b.poId && delta.received) {
        const po = this.ref(a, "po", b.poId),
          line = po.lines.find((l: any) => l.id === b.lineId),
          after = this.receiptTotal(a, b.poId, b.lineId) + delta.received;
        requireThat(
          line && after >= 0 && after <= line.quantity,
          "Reversal would exceed PO quantity; reverse replacement receipts first",
        );
      }
      const tb = this.balance(a, b.partId, b.locationId, b.taskId);
      requireThat(
        bal.onHand + delta.stock >= -1e-6 &&
          bal.reserved + delta.reserved >= -1e-6 &&
          bal.available + delta.stock - delta.reserved >= -1e-6 &&
          tb.reserved + delta.reserved >= -1e-6 &&
          tb.issued + delta.issued >= -1e-6 &&
          tb.installed + delta.installed >= -1e-6,
        "Reverse dependent movements first",
      );
    }
    const record = this.store.add(a, "movement", { ...b, ...delta, assetId });
    if (b.action === "transfer")
      this.store.add(a, "movement", {
        ...b,
        action: "transfer-in",
        locationId: b.toLocationId,
        referenceId: record.id,
        assetId,
        stock: q,
        reserved: 0,
        issued: 0,
        installed: 0,
        received: 0,
      });
    return record;
  }
  workerCapacity(a: Actor, project: R, worker: R, day: string) {
    const c = effectiveCalendar(this.store, a, worker.id, day);
    const p = {
      ...project,
      holidays: [
        ...(project.holidays || []),
        ...(project.closures || []),
        ...(c?.holidays || []),
      ],
      workdays: (project.workdays || [1, 2, 3, 4, 5]).filter(
        (d: number) => !c || c.workdays.includes(d),
      ),
    };
    return capacity(
      p,
      {
        ...worker,
        dailyHours: c
          ? Math.max(0, c.shiftHours - c.unpaidBreak)
          : worker.dailyHours,
      },
      day,
      this.store.list(a.org, "leave"),
    );
  }
  assignmentConflicts(a: Actor, b: any, exclude?: string) {
    this.validateRefs(a, b);
    const w = this.ref(a, "worker", b.workerId),
      p = this.ref(a, "project", b.projectId),
      t = this.ref(a, "task", b.taskId);
    const others = this.store
      .list(a.org, "assignment")
      .filter(
        (x) =>
          x.id !== exclude &&
          x.workerId === b.workerId &&
          x.date === b.date &&
          x.status !== "Cancelled",
      );
    const conflicts: string[] = [];
    if (b.start + b.hours > 24)
      conflicts.push("Shift crosses midnight; split it into dated shifts");
    if (
      b.crewId &&
      effectiveCrew(this.store, a, w.id, b.date)?.crew.id !== b.crewId
    )
      conflicts.push(
        "Worker is not an effective member of this crew on the assignment date",
      );
    if (!w.active) conflicts.push("Worker is inactive");
    if (!t.released) conflicts.push("Task is not released");
    if (
      others.some(
        (x) => b.start < x.start + x.hours && b.start + b.hours > x.start,
      )
    )
      conflicts.push("Worker has an overlapping assignment");
    const available = this.workerCapacity(a, p, w, b.date);
    if (others.reduce((s, x) => s + x.hours, 0) + b.hours > available)
      conflicts.push(
        `Planned hours exceed ${available} available hours (calendar/leave included)`,
      );
    if (
      t.requiredSkill &&
      !w.skills.some(
        (s: any) =>
          s.name.toLowerCase() === t.requiredSkill.toLowerCase() &&
          (!s.expires || s.expires >= b.date),
      )
    )
      conflicts.push("Required certification is missing or expired");
    const c = effectiveCalendar(this.store, a, w.id, b.date);
    if (c) {
      if (
        b.start < c.shiftStart ||
        b.start + b.hours > c.shiftStart + c.shiftHours
      )
        conflicts.push("Outside worker shift window");
      const dayIndex = (new Date(b.date + "T00:00:00Z").getUTCDay() + 6) % 7,
        weekStart = addDays(b.date, -dayIndex);
      const total =
        this.store
          .list(a.org, "assignment")
          .filter(
            (x) =>
              x.id !== exclude &&
              x.workerId === w.id &&
              x.status !== "Cancelled" &&
              x.date >= weekStart &&
              x.date < addDays(weekStart, 7),
          )
          .reduce((s, x) => s + x.hours, 0) + b.hours;
      if (total > c.weeklyLimit && !c.overtimeAllowed)
        conflicts.push("Weekly limit requires authorized overtime");
    }
    for (const id of t.dependencies || []) {
      const dep = this.ref(a, "task", id);
      const produced = this.all(a, "production")
        .filter((x) => x.taskId === id && x.status === "Approved")
        .reduce((n, x) => n + x.quantity, 0);
      if (produced < dep.target || !dep.target) {
        const end = dep.forecastEnd || dep.baselineEnd;
        if (!end) conflicts.push("Dependency finish is unconfirmed");
        else if (b.date <= end)
          conflicts.push("Assignment precedes dependency finish");
      }
    }
    for (const id of t.equipmentIds || []) {
      const eq = this.ref(a, "equipment", id);
      if (
        !eq.availableFrom ||
        b.date < eq.availableFrom ||
        (eq.availableUntil && b.date > eq.availableUntil)
      )
        conflicts.push("Required equipment is outside its availability window");
      const collision = this.store
        .list(a.org, "assignment")
        .some(
          (x) =>
            x.id !== exclude &&
            x.taskId !== t.id &&
            x.status !== "Cancelled" &&
            x.date === b.date &&
            b.start < x.start + x.hours &&
            x.start < b.start + b.hours &&
            (
              this.store.get(a.org, "task", x.taskId).equipmentIds || []
            ).includes(id),
        );
      if (collision)
        conflicts.push(
          "Required equipment is assigned to another work package",
        );
    }
    return conflicts;
  }
  moveAssignment(a: Actor, id: string, raw: any) {
    this.allowed(a, "assignment");
    const old = this.ref(a, "assignment", id);
    requireThat(old.status !== "Cancelled", "Cancelled assignment cannot move");
    const b = schemas.assignment.parse({ ...old, ...raw });
    const conflicts = this.assignmentConflicts(a, b, id);
    requireThat(
      !conflicts.length || b.override.trim().length >= 10,
      conflicts.join("; "),
      409,
    );
    return this.store.update(
      a,
      "assignment",
      id,
      { ...b, conflicts },
      z.number().int().parse(raw.version),
    );
  }
  timeConflicts(a: Actor, b: any, exclude?: string) {
    const total = b.regular + b.overtime;
    requireThat(
      !this.store
        .list(a.org, "time")
        .some(
          (t) =>
            t.id !== exclude &&
            t.workerId === b.workerId &&
            t.date === b.date &&
            t.status !== "Rejected" &&
            b.start < t.start + t.regular + t.overtime &&
            b.start + total > t.start,
        ),
      "Overlapping or duplicate time entry",
      409,
    );
  }
  readiness(a: Actor, projectId?: string) {
    const tasks = this.all(a, "task").filter(
      (t) => !projectId || t.projectId === projectId,
    );
    const requirements = this.all(a, "requirement");
    return tasks.map((t) => {
      const lines = requirements
        .filter((r) => r.taskId === t.id)
        .map((r) => {
          const part = this.ref(a, "part", r.partId);
          const substitutes = this.all(a, "substitution")
            .filter(
              (s) =>
                s.taskId === t.id &&
                s.originalPartId === r.partId &&
                s.status === "Approved",
            )
            .map((s) => s.replacementPartId);
          const coverage = [r.partId, ...new Set(substitutes)].reduce(
            (sum, partId) => {
              const b = this.balance(a, partId, undefined, t.id);
              return sum + b.reserved + b.issued + b.installed;
            },
            0,
          );
          const shortage = Math.max(0, r.quantity - coverage);
          const orders = this.all(a, "po")
            .filter(
              (p) =>
                p.projectId === r.projectId &&
                ["Issued", "Acknowledged"].includes(p.status),
            )
            .flatMap((p) =>
              p.lines
                .filter((l: any) => l.partId === r.partId)
                .map((l: any) => ({
                  ...l,
                  remaining: l.quantity - this.receiptTotal(a, p.id, l.id),
                })),
            )
            .filter((l: any) => l.remaining > 0);
          const late = orders.some(
            (l: any) =>
              l.confirmedETA &&
              r.needBy &&
              addDays(
                l.confirmedETA,
                this.ref(a, "project", r.projectId).stagingDays ?? 2,
              ) > r.needBy,
          );
          return {
            ...r,
            partNumber: part.partNumber,
            description: part.description,
            coverage,
            shortage,
            available: this.balance(a, r.partId).available,
            risk: shortage
              ? late
                ? "Late delivery"
                : orders.some((l: any) => l.confirmedETA)
                  ? "Awaiting delivery"
                  : "ETA unconfirmed"
              : "Ready",
          };
        });
      const holds = this.all(a, "hold").filter(
        (h) =>
          h.taskId === t.id &&
          h.status !== "Resolved" &&
          h.status !== "Rejected",
      );
      const status =
        !t.released || holds.length
          ? "Blocked"
          : !lines.length && t.materialRequired !== false
            ? "Unconfirmed"
            : lines.every((l) => l.shortage === 0)
              ? "Ready"
              : lines.some((l) => l.coverage > 0)
                ? "Partial"
                : "Blocked";
      return {
        taskId: t.id,
        projectId: t.projectId,
        name: t.name,
        section: t.section,
        status,
        lines,
        holds,
        baselineStart: t.baselineStart,
        baselineEnd: t.baselineEnd,
        reason: !t.released
          ? "Section has not been released"
          : holds[0]?.reason ||
            (!lines.length && t.materialRequired !== false
              ? "Material requirements not entered"
              : lines.some((l) => l.shortage > 0)
                ? "Required stock is not fully allocated"
                : "All required stock allocated, issued, or installed"),
      };
    });
  }
  forecast(a: Actor, projectId?: string) {
    return this.all(a, "task")
      .filter((t) => !projectId || t.projectId === projectId)
      .map((t) => {
        const times = this.all(a, "time").filter(
          (x) =>
            x.taskId === t.id &&
            ["Approved", "Locked", "Correction requested"].includes(x.status),
        );
        const installed = this.all(a, "production")
          .filter((x) => x.taskId === t.id && x.status === "Approved")
          .reduce((s, x) => s + x.quantity, 0);
        const rf = this.all(a, "reforecast")
          .filter((x) => x.taskId === t.id && x.status === "Approved")
          .at(-1);
        const actual = times.reduce((s, x) => s + x.regular + x.overtime, 0);
        return {
          taskId: t.id,
          projectId: t.projectId,
          name: t.name,
          section: t.section,
          laborType: t.laborType,
          unit: t.unit,
          target: t.target,
          installed,
          progress: t.target
            ? Math.min(100, (installed / t.target) * 100)
            : null,
          planned: this.all(a, "assignment")
            .filter((x) => x.taskId === t.id && x.status !== "Cancelled")
            .reduce((s, x) => s + x.hours, 0),
          actual,
          allocatedBudget: t.allocatedHours ?? null,
          budgetVariance:
            t.allocatedHours == null ? null : t.allocatedHours - actual,
          earned: installed * t.unitHours,
          remaining: rf?.remainingHours ?? null,
          estimateAtCompletion: rf ? actual + rf.remainingHours : null,
        };
      });
  }
  snapshot(a: Actor) {
    if (a.role === "vendor")
      return vendorWorkspace(
        this.store,
        a,
        projectIds(this.store, a) || new Set(),
      );
    const kinds = [
      ...Object.keys(schemas),
      "movement",
      "settings",
      "timer",
      "leveling",
      "publication",
    ];
    const data: Record<string, any> = {};
    for (const kind of kinds) data[kind] = this.all(a, kind);
    if (!canCost(a)) {
      data.quote = [];
      data.poAmendment = [];
      data.credit = [];
      data.po = data.po.map((p: R) => {
        const { freight, tax, notes, source, ...rest } = p;
        return { ...rest, lines: p.lines.map(({ unitCost, ...l }: any) => l) };
      });
    }
    if (a.role === "worker") {
      for (const k of ["worker", "leave", "assignment", "time"])
        data[k] = data[k].filter((r: R) =>
          k === "worker" ? r.id === a.workerId : r.workerId === a.workerId,
        );
      const projectIds = new Set(data.assignment.map((r: R) => r.projectId));
      for (const k of [
        "project",
        "task",
        "requirement",
        "po",
        "production",
        "reforecast",
        "hold",
        "change",
        "rfq",
        "substitution",
      ])
        data[k] = data[k].filter((r: R) =>
          projectIds.has(k === "project" ? r.id : r.projectId),
        );
      data.movement = [];
      data.supplier = [];
      data.publication = [];
      data.retention = [];
      data.leveling = [];
      data.calendar = data.calendar.filter((c: R) => c.workerId === a.workerId);
      data.rfq = [];
    }
    const readiness = this.readiness(a),
      forecast = this.forecast(a);
    if (a.role === "viewer") {
      const releases = this.all(a, "publication").filter(
        (r) => r.status === "Published",
      );
      const latest = new Map<string, R>();
      for (const r of releases) latest.set(r.projectId, r);
      return {
        actor: a,
        data: {
          project: [...latest.values()].map((r) => r.project),
          task: [...latest.values()].flatMap((r) => r.tasks),
        },
        readiness: [...latest.values()].flatMap((r) => r.readiness),
        forecast: [...latest.values()].flatMap((r) => r.forecast),
        audit: [],
      };
    }
    data.assignment = data.assignment.map((r: R) => ({
      ...r,
      currentConflicts:
        r.status === "Cancelled" ? [] : this.assignmentConflicts(a, r, r.id),
    }));
    return {
      actor: a,
      data,
      readiness:
        a.role === "worker"
          ? readiness.filter((r) =>
              data.project.some((p: R) => p.id === r.projectId),
            )
          : readiness,
      forecast: a.role === "worker" ? [] : forecast,
      audit: ["admin", "pm"].includes(a.role)
        ? this.store
            .auditList(a.org)
            .filter(
              (e: any) =>
                a.role === "admin" ||
                Object.values(data).some(
                  (records: any) =>
                    Array.isArray(records) &&
                    records.some((r: R) => r.id === e.entity),
                ),
            )
        : [],
      balances: data.part.flatMap((p: R) =>
        data.location.map((l: R) => ({
          partId: p.id,
          locationId: l.id,
          ...this.balance(a, p.id, l.id),
        })),
      ),
    };
  }
}
