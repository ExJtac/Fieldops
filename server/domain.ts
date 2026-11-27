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
import { schemas, type Kind, date, qty } from "./schemas.js";
const permissions: Record<string, Role[]> = {
  project: ["admin", "pm"],
  task: ["admin", "pm"],
  part: ["admin", "purchasing"],
  supplier: ["admin", "purchasing"],
  location: ["admin", "purchasing"],
  requirement: ["admin", "pm", "purchasing"],
  quote: ["admin", "purchasing"],
  rfq: ["admin", "purchasing"],
  po: ["admin", "purchasing"],
  worker: ["admin", "pm"],
  leave: ["admin", "pm"],
  assignment: ["admin", "pm"],
  time: ["admin", "pm", "foreman", "worker"],
  production: ["admin", "pm", "foreman"],
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
    return this.store.get(a.org, kind, id);
  }
  all(a: Actor, kind: string) {
    return this.store.list(a.org, kind);
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
      const result = fn();
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
    requireThat(kind in schemas, "Unknown record type");
    const b: any = schemas[kind].parse(raw);
    this.validateRefs(a, b);
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
        !this.all(a, "po").some((p) => p.number === b.number),
        "PO number already exists",
      );
      b.status = "Draft";
      b.lines = b.lines.map((l: any) => {
        this.ref(a, "part", l.partId);
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
      b.status = "Draft";
    }
    if (kind === "leave")
      requireThat(
        !this.all(a, "leave").some(
          (l) => l.workerId === b.workerId && l.date === b.date,
        ),
        "Leave already recorded on this date",
      );
    if (kind === "production") {
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
    return this.store.add(a, kind, b);
  }
  edit(a: Actor, kind: Kind, id: string, raw: any) {
    this.allowed(a, kind);
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
        "Only draft POs can be edited. Cancel the unreceived balance and create a replacement for issued orders",
      );
      requireThat(
        b.projectId === old.projectId && b.number === old.number,
        "PO project and number cannot change",
      );
      b.lines = b.lines.map((l: any, i: number) => {
        this.ref(a, "part", l.partId);
        requireThat(l.leadMax >= l.leadMin, "Invalid lead time");
        return { ...l, id: old.lines[i]?.id || randomUUID() };
      });
    }
    if (kind === "time") {
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
      this.timeConflicts(a, b, id);
      b.status = "Draft";
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
        if (status === "Approved") this.separation(a, r);
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
      { status, reviewedBy: a.id, reviewReason: raw.reason || "" },
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
    const ms = this.all(a, "movement").filter(
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
  movement(a: Actor, raw: any) {
    requireThat(
      ["admin", "purchasing", "foreman"].includes(a.role),
      "Your role cannot move inventory",
      403,
    );
    const b = z
      .object({
        action: z.enum([
          "receive",
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
      })
      .parse(raw);
    this.ref(a, "part", b.partId);
    this.ref(a, "location", b.locationId);
    if (b.taskId) this.validateRefs(a, b);
    const bal = this.balance(a, b.partId, b.locationId),
      taskBal = this.balance(a, b.partId, b.locationId, b.taskId);
    const q = b.quantity;
    let delta: any = {
      stock: 0,
      reserved: 0,
      issued: 0,
      installed: 0,
      received: 0,
    };
    if (b.action === "receive" || b.action === "return") {
      this.allowed(a, "po");
      const po = this.ref(a, "po", b.poId);
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
        delta.stock = q;
        delta.received = q;
      } else {
        requireThat(
          q <= received && q <= bal.available,
          "Cannot return reserved, issued, or unreceived stock",
        );
        delta.stock = -q;
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
        ["stock", "reserved", "issued", "installed", "received"].map((k) => [
          k,
          -original[k],
        ]),
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
    const record = this.store.add(a, "movement", { ...b, ...delta });
    if (b.action === "transfer")
      this.store.add(a, "movement", {
        ...b,
        action: "transfer-in",
        locationId: b.toLocationId,
        referenceId: record.id,
        stock: q,
        reserved: 0,
        issued: 0,
        installed: 0,
        received: 0,
      });
    return record;
  }
  assignmentConflicts(a: Actor, b: any, exclude?: string) {
    this.validateRefs(a, b);
    const w = this.ref(a, "worker", b.workerId),
      p = this.ref(a, "project", b.projectId),
      t = this.ref(a, "task", b.taskId);
    const others = this.all(a, "assignment").filter(
      (x) =>
        x.id !== exclude &&
        x.workerId === b.workerId &&
        x.date === b.date &&
        x.status !== "Cancelled",
    );
    const conflicts: string[] = [];
    if (b.start + b.hours > 24)
      conflicts.push("Shift crosses midnight; split it into dated shifts");
    if (!w.active) conflicts.push("Worker is inactive");
    if (!t.released) conflicts.push("Task is not released");
    if (
      others.some(
        (x) => b.start < x.start + x.hours && b.start + b.hours > x.start,
      )
    )
      conflicts.push("Worker has an overlapping assignment");
    const available = capacity(p, w, b.date, this.all(a, "leave"));
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
      !this.all(a, "time").some(
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
              addDays(l.confirmedETA, 2) > r.needBy,
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
          : !lines.length
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
            (!lines.length
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
          earned: installed * t.unitHours,
          remaining: rf?.remainingHours ?? null,
          estimateAtCompletion: rf ? actual + rf.remainingHours : null,
        };
      });
  }
  snapshot(a: Actor) {
    const kinds = [...Object.keys(schemas), "movement", "settings"];
    const data: Record<string, any> = {};
    for (const kind of kinds) data[kind] = this.all(a, kind);
    if (!canCost(a)) {
      data.quote = [];
      data.po = data.po.map((p: R) => {
        const { freight, tax, ...rest } = p;
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
      data.rfq = [];
    }
    const readiness = this.readiness(a),
      forecast = this.forecast(a);
    if (a.role === "viewer")
      return {
        actor: a,
        data: {
          project: data.project.map(({ id, name, customer }: R) => ({
            id,
            name,
            customer,
          })),
          task: data.task.map(({ id, projectId, name, section }: R) => ({
            id,
            projectId,
            name,
            section,
          })),
        },
        readiness: readiness.map(({ lines, holds, ...r }) => ({
          ...r,
          holds: holds.map((h) => ({ reason: h.reason })),
        })),
        forecast: forecast.map(
          ({
            taskId,
            projectId,
            name,
            section,
            installed,
            target,
            unit,
            progress,
          }) => ({
            taskId,
            projectId,
            name,
            section,
            installed,
            target,
            unit,
            progress,
          }),
        ),
        audit: [],
      };
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
        ? this.store.auditList(a.org)
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
