import { saveAdapter, retryAdapter } from "./adapters.js";
import { savePrice } from "./financial.js";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  type Actor,
  type RecordData as R,
  requireThat,
  passwordHash,
} from "./store.js";
import { Operations, addDays } from "./domain.js";
import { projectAccess, payrollAccess, projectIds } from "./access.js";
import { extraSchemas } from "./extensions-schema.js";
import { schemas, date } from "./schemas.js";
import { processEvents } from "./events.js";
import { validateExtra } from "./extensions-validation.js";
export class Advanced {
  constructor(public o: Operations) {}
  admin(a: Actor) {
    requireThat(a.role === "admin", "Administrator required", 403);
  }
  manager(a: Actor) {
    requireThat(
      ["admin", "pm"].includes(a.role),
      "Project manager required",
      403,
    );
  }
  transition(a: Actor, kind: string, id: string, body: any) {
    const o = this.o,
      r = o.ref(a, kind, id),
      status = z.string().parse(body.status),
      version = z.number().int().parse(body.version);
    requireThat(r.version === version, "Record changed; reload", 409);
    if (kind === "shipment") {
      o.allowed(a, "shipment");
      if (status === "Cancelled")
        requireThat(
          !o
            .all(a, "movement")
            .some((m) => m.shipmentId === r.id && m.action === "receive"),
          "Received shipment cannot be cancelled",
        );
      const next: Record<string, string[]> = {
        Planned: ["Shipped", "Cancelled"],
        Shipped: ["Delivered", "Cancelled"],
      };
      requireThat(
        next[r.status]?.includes(status),
        "Invalid shipment transition",
      );
      return o.store.update(
        a,
        kind,
        id,
        {
          status,
          actualDate:
            status === "Delivered"
              ? date.parse(body.actualDate)
              : r.actualDate || "",
        },
        version,
      );
    }
    if (kind === "notice") {
      requireThat(r.recipientId === a.id, "Own notification only", 403);
      requireThat(status === "Acknowledged", "Invalid acknowledgement");
      return o.store.update(
        a,
        kind,
        id,
        { status, acknowledgedAt: new Date().toISOString() },
        version,
      );
    }
    if (kind === "quote") {
      o.allowed(a, "quote");
      requireThat(
        (r.status || "Quoted") === "Quoted" &&
          ["Approved", "Rejected"].includes(status),
        "Invalid quote transition",
      );
      if (status === "Approved") {
        this.admin(a);
        o.separation(a, r);
      }
      return o.store.update(a, kind, id, { status, reviewedBy: a.id }, version);
    }
    requireThat(
      r.status === "Proposed" && ["Approved", "Rejected"].includes(status),
      "Invalid proposal transition",
    );
    if (["poAmendment", "credit", "conversion", "adjustment"].includes(kind))
      this.admin(a);
    else this.manager(a);
    if (status === "Approved") {
      o.separation(a, r);
      if (kind === "availability") {
        o.create(a, "leave", {
          workerId: r.workerId,
          date: r.date,
          hours: r.hours,
          reason: "Approved availability request",
        });
      }
      if (kind === "poAmendment") {
        validateExtra(o, a, kind, r);
        const po = o.ref(a, "po", r.poId);
        // Open shipment allocations must remain valid after revision.
        for (const line of r.lines) {
          const shipped = o
            .all(a, "shipment")
            .filter((s) => s.poId === po.id && s.status !== "Cancelled")
            .flatMap((s) => s.lines)
            .filter((s: any) => s.lineId === line.id)
            .reduce((n: number, s: any) => n + s.quantity, 0);
          requireThat(
            line.quantity >= shipped,
            "Revise/cancel split shipments before reducing order quantity",
          );
        }
        o.store.update(
          a,
          "po",
          po.id,
          {
            lines: r.lines.map((l: R) => {
              const old = po.lines.find((x: R) => x.id === l.id);
              return {
                ...l,
                backordered: Math.min(
                  old?.backordered || 0,
                  Math.max(0, l.quantity - o.receiptTotal(a, po.id, l.id)),
                ),
                backorderReason: old?.backorderReason || "",
              };
            }),
            freight: r.freight,
            tax: r.tax,
            amendmentId: r.id,
          },
          po.version,
        );
      }
      if (kind === "credit") {
        const m = o.ref(a, "movement", r.returnMovementId);
        requireThat(
          !o
            .all(a, "movement")
            .some((x) => x.action === "reverse" && x.referenceId === m.id),
          "Return has been reversed",
        );
      }
      if (kind === "adjustment") {
        if (r.assetId) {
          const asset = o.ref(a, "asset", r.assetId);
          requireThat(
            asset.version === r.assetVersion,
            "Asset custody changed; propose damage again",
            409,
          );
          const stock = ["Received", "Reserved"].includes(asset.status)
              ? -1
              : 0,
            reserved = asset.status === "Reserved" ? -1 : 0,
            issued = asset.status === "Issued" ? -1 : 0,
            installed = asset.status === "Installed" ? -1 : 0;
          const movement = o.store.add(a, "movement", {
            projectId: r.projectId,
            partId: r.partId,
            locationId: r.locationId,
            quantity: 1,
            action: "damage",
            stock,
            reserved,
            issued,
            installed,
            received: 0,
            note: r.reason,
            adjustmentId: r.id,
            assetId: asset.id,
            taskId: asset.taskId || "",
            poId: "",
            lineId: "",
          });
          o.store.update(
            a,
            "asset",
            asset.id,
            {
              status: "Damaged",
              condition: "Damaged",
              lastMovementId: movement.id,
            },
            asset.version,
          );
        } else {
          const serialCount = o.store
            .list(a.org, "asset")
            .filter(
              (x) =>
                x.partId === r.partId &&
                x.locationId === r.locationId &&
                x.status === "Received",
            ).length;
          const b = o.balance(a, r.partId, r.locationId);
          requireThat(
            b.available + r.quantity >= serialCount,
            "Adjustment cannot consume serialized stock; select the affected asset",
          );
          requireThat(
            b.available + r.quantity >= -1e-6,
            "Adjustment would consume reserved stock or produce negative inventory",
          );
          o.store.add(a, "movement", {
            projectId: r.projectId,
            partId: r.partId,
            locationId: r.locationId,
            quantity: Math.abs(r.quantity),
            action: r.action,
            stock: r.quantity,
            reserved: 0,
            issued: 0,
            installed: 0,
            received: 0,
            note: r.reason,
            adjustmentId: r.id,
            taskId: "",
            poId: "",
            lineId: "",
          });
        }
      }
      if (kind === "scheduleRevision") {
        for (const d of r.dates) {
          const t = o.ref(a, "task", d.taskId);
          requireThat(
            t.version === r.taskVersions[t.id],
            "A task changed; prepare a fresh schedule revision",
            409,
          );
          o.store.update(
            a,
            "task",
            t.id,
            {
              ...(r.mode === "baseline"
                ? {
                    baselineStart: d.start,
                    baselineEnd: d.finish,
                    originalBaseline: t.originalBaseline || {
                      start: t.baselineStart,
                      finish: t.baselineEnd,
                    },
                  }
                : { forecastStart: d.start, forecastEnd: d.finish }),
              scheduleRevisionId: r.id,
            },
            t.version,
          );
        }
      }
      if (kind === "productionCorrection") {
        const p = o.ref(a, "production", r.productionId);
        requireThat(
          p.version === r.originalVersion && p.status === "Approved",
          "Production changed; prepare a fresh correction",
          409,
        );
        o.store.update(
          a,
          "production",
          p.id,
          { quantity: r.quantity, correctionId: r.id },
          p.version,
        );
      }
    }
    return o.store.update(
      a,
      kind,
      id,
      { status, reviewedBy: a.id, reviewedAt: new Date().toISOString() },
      version,
    );
  }
  grants(a: Actor, b: any) {
    this.admin(a);
    const input = z
      .object({
        userId: z.string(),
        projectIds: z.array(z.string()).max(5000),
        payroll: z.boolean().default(false),
        commercial: z.boolean().default(false),
      })
      .parse(b);
    const user = this.o.store.user(input.userId, a.org);
    requireThat(user.org === a.org, "Account belongs to another organization");
    requireThat(
      !(input.payroll || input.commercial) ||
        ["admin", "pm", "finance"].includes(user.role),
      "Financial permissions are limited to administrators, project managers and finance accounts",
    );
    for (const p of input.projectIds) this.o.ref(a, "project", p);
    const db = this.o.store.db;
    db.prepare("DELETE FROM project_access WHERE org=? AND user_id=?").run(
      a.org,
      user.id,
    );
    for (const p of new Set(input.projectIds))
      db.prepare("INSERT INTO project_access VALUES(?,?,?)").run(
        a.org,
        user.id,
        p,
      );
    db.prepare(
      "INSERT INTO financial_access VALUES(?,?,?) ON CONFLICT(org,user_id) DO UPDATE SET payroll=excluded.payroll",
    ).run(a.org, user.id, input.payroll ? 1 : 0);
    db.prepare("DELETE FROM commercial_access WHERE org=? AND user_id=?").run(
      a.org,
      user.id,
    );
    if (input.commercial)
      db.prepare("INSERT INTO commercial_access VALUES(?,?)").run(
        a.org,
        user.id,
      );
    this.o.store.audit(a, "access.updated", user.id, {
      commercial: input.commercial,
      projects: input.projectIds,
      payroll: input.payroll,
    });
    return { ok: true };
  }
  publish(a: Actor, b: any) {
    this.manager(a);
    const p = this.o.ref(a, "project", z.string().parse(b.projectId));
    const readiness = this.o.readiness(a, p.id).map((r) => ({
      taskId: r.taskId,
      projectId: p.id,
      name: r.name,
      section: r.section,
      status: r.status,
      reason:
        r.status === "Ready"
          ? "Ready for work"
          : "Open material or schedule constraints",
      baselineStart: r.baselineStart,
      baselineEnd: r.baselineEnd,
      holds: [],
    }));
    const forecast = this.o
      .forecast(a, p.id)
      .map(
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
      );
    return this.o.store.add(a, "publication", {
      projectId: p.id,
      status: "Published",
      project: { id: p.id, name: p.name, customer: p.customer },
      tasks: this.o
        .all(a, "task")
        .filter((t) => t.projectId === p.id)
        .map(({ id, name, section, projectId }) => ({
          id,
          name,
          section,
          projectId,
        })),
      readiness,
      forecast,
    });
  }
  assetMove(a: Actor, id: string, b: any) {
    requireThat(
      ["admin", "purchasing", "foreman"].includes(a.role),
      "Inventory role required",
      403,
    );
    const asset = this.o.ref(a, "asset", id);
    const input = z
      .object({
        version: z.number().int(),
        action: z.enum([
          "reserve",
          "release",
          "issue",
          "install",
          "return",
          "transfer",
        ]),
        taskId: z.string().default(""),
        projectId: z.string(),
        toLocationId: z.string().default(""),
        note: z.string().min(3),
      })
      .parse(b);
    requireThat(asset.version === input.version, "Asset changed", 409);
    requireThat(
      asset.projectId === input.projectId || input.action === "transfer",
      "Transfer custody explicitly before changing projects",
    );
    if (asset.taskId)
      requireThat(
        !input.taskId || input.taskId === asset.taskId,
        "Release current task custody before changing tasks",
      );
    const states: Record<string, string[]> = {
      Received: ["reserve", "transfer", "return"],
      Reserved: ["release", "issue"],
      Issued: ["install"],
      Installed: [],
    };
    requireThat(
      states[asset.status]?.includes(input.action),
      "Invalid serialized custody transition",
    );
    const receipt = this.o.ref(a, "movement", asset.receiptId);
    const movement = this.o.movement(
      a,
      {
        ...input,
        partId: asset.partId,
        locationId: asset.locationId,
        quantity: 1,
        taskId: input.taskId || asset.taskId,
        poId: receipt.poId,
        lineId: receipt.lineId,
      },
      asset.id,
    );
    const status = (
      {
        reserve: "Reserved",
        release: "Received",
        issue: "Issued",
        install: "Installed",
        return: "Returned",
        transfer: "Received",
      } as any
    )[input.action];
    return this.o.store.update(
      a,
      "asset",
      id,
      {
        status,
        locationId:
          input.action === "transfer" ? input.toLocationId : asset.locationId,
        taskId: input.action === "release" ? "" : input.taskId || asset.taskId,
        projectId: input.projectId,
        lastMovementId: movement.id,
      },
      asset.version,
    );
  }
  quoteToPo(a: Actor, id: string, b: any) {
    this.o.allowed(a, "po");
    const q = this.o.ref(a, "quote", id);
    requireThat(q.status === "Approved", "Approve the selected quote first");
    const quantity = z.number().positive().parse(b.quantity),
      tier = [...(q.tiers || [])]
        .filter((t) => t.minimum <= quantity)
        .sort((a, b) => b.minimum - a.minimum)[0];
    requireThat(
      !q.validUntil || q.validUntil >= new Date().toISOString().slice(0, 10),
      "Quote expired",
    );
    const po = this.o.create(a, "po", {
      projectId: q.projectId,
      supplierId: q.supplierId,
      number: z.string().min(1).parse(b.number),
      currency: q.currency,
      freight: q.freight,
      tax: q.tax,
      source: "Quote " + q.id,
      lines: [
        {
          partId: q.partId,
          quantity,
          unitCost: tier?.unitCost ?? q.unitCost,
          leadMin: q.leadMin,
          leadMax: q.leadMax,
          ackDate: q.ackDate,
        },
      ],
    });
    return po;
  }
  shortageRfqs(a: Actor, b: any) {
    this.o.allowed(a, "rfq");
    const projectId = z.string().parse(b.projectId);
    this.o.ref(a, "project", projectId);
    const supplierId = z.string().parse(b.supplierId);
    this.o.ref(a, "supplier", supplierId);
    const map = new Map<string, { quantity: number; needBy: string }>();
    for (const t of this.o.readiness(a, projectId))
      for (const l of t.lines as R[]) {
        const current = map.get(l.partId) || { quantity: 0, needBy: l.needBy };
        current.quantity += l.shortage;
        if (l.needBy && (!current.needBy || l.needBy < current.needBy))
          current.needBy = l.needBy;
        map.set(l.partId, current);
      }
    const results = [];
    for (const [partId, v] of map) {
      const incoming = this.o
        .all(a, "po")
        .filter(
          (p) =>
            p.projectId === projectId &&
            ["Issued", "Acknowledged"].includes(p.status),
        )
        .flatMap((p) =>
          p.lines
            .filter((l: any) => l.partId === partId)
            .map((l: any) =>
              Math.max(0, l.quantity - this.o.receiptTotal(a, p.id, l.id)),
            ),
        )
        .reduce((n: number, q: number) => n + q, 0);
      v.quantity = Math.max(
        0,
        v.quantity - this.o.balance(a, partId).available - incoming,
      );
      if (v.quantity > 0)
        results.push(
          this.o.create(a, "rfq", {
            projectId,
            supplierId,
            partId,
            quantity: v.quantity,
            needBy: v.needBy,
            notes:
              "Net purchasing shortage after available stock and open project POs; allocations still required before work.",
          }),
        );
    }
    return { count: results.length, records: results };
  }
  workerReview(a: Actor, id: string, b: any) {
    const t = this.o.ref(a, "time", id);
    requireThat(
      a.workerId === t.workerId,
      "Only this worker can review their time",
      403,
    );
    requireThat(
      ["Draft", "Submitted"].includes(t.status),
      "Review requires draft or submitted time",
    );
    return this.o.store.update(
      a,
      "time",
      id,
      { workerReviewed: true, reviewedByWorker: a.id },
      z.number().int().parse(b.version),
    );
  }
  timer(a: Actor, b: any) {
    z.enum(["start", "stop"]).parse(b.action);
    this.o.allowed(a, "time");
    const workerId = z.string().parse(b.workerId);
    if (a.role === "worker")
      requireThat(a.workerId === workerId, "Own timer only", 403);
    this.o.ref(a, "worker", workerId);
    const active = this.o.store
      .list(a.org, "timer")
      .find((t) => t.workerId === workerId && t.status === "Running");
    if (b.action === "start") {
      requireThat(!active, "Worker already has a running timer", 409);
      this.o.validateRefs(a, b);
      const t = this.o.ref(a, "task", b.taskId),
        project = this.o.ref(a, "project", t.projectId);
      if (a.role === "worker")
        requireThat(
          this.o
            .all(a, "assignment")
            .some(
              (x) =>
                x.workerId === workerId &&
                x.projectId === project.id &&
                x.status !== "Cancelled",
            ),
          "A worker timer requires a project assignment",
          403,
        );
      return this.o.store.add(a, "timer", {
        workerId,
        projectId: project.id,
        taskId: t.id,
        status: "Running",
        startedAt: new Date().toISOString(),
        costCodeId: b.costCodeId || "",
      });
    }
    requireThat(active, "No running timer");
    const end = Date.now(),
      start = Date.parse(active.startedAt),
      elapsed = (end - start) / 3600000;
    requireThat(
      elapsed >= 1 / 3600 && elapsed <= 16,
      "Timer duration must be 1 second–16 hours; cancel and enter a reviewed manual timecard",
    );
    const p = this.o.ref(a, "project", active.projectId),
      fmt = new Intl.DateTimeFormat("en-CA", {
        timeZone: p.timezone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hourCycle: "h23",
      });
    const parts = Object.fromEntries(
      fmt.formatToParts(new Date(start)).map((p) => [p.type, p.value]),
    );
    const localDate = `${parts.year}-${parts.month}-${parts.day}`,
      hour =
        Number(parts.hour) +
        Number(parts.minute) / 60 +
        Number(parts.second) / 3600;
    requireThat(
      hour + elapsed <= 24,
      "Timer crossed local midnight; cancel and split manual entries by date",
    );
    const endParts = Object.fromEntries(
      fmt.formatToParts(new Date(end)).map((p) => [p.type, p.value]),
    );
    const endHour =
      Number(endParts.hour) +
      Number(endParts.minute) / 60 +
      Number(endParts.second) / 3600;
    requireThat(
      Math.abs(endHour - hour - elapsed) < 0.01,
      "Timer crosses a daylight-saving clock change; cancel and enter reviewed manual hours",
    );
    const entry = this.o.create(a, "time", {
      projectId: active.projectId,
      taskId: active.taskId,
      workerId,
      date: localDate,
      start: hour,
      regular: Math.min(elapsed, 8),
      overtime: Math.max(0, elapsed - 8),
      costCodeId: active.costCodeId,
      notes: "Recorded by timer; review before submission.",
    });
    this.o.store.update(
      a,
      "timer",
      active.id,
      {
        status: "Stopped",
        endedAt: new Date(end).toISOString(),
        timeId: entry.id,
      },
      active.version,
    );
    return entry;
  }
  rates(a: Actor, b: any) {
    requireThat(
      payrollAccess(this.o.store, a),
      "Explicit payroll permission required",
      403,
    );
    const v = z
      .object({
        workerId: z.string(),
        effective: date,
        rate: z.number().min(0),
        overtimeMultiplier: z.number().min(1).max(5),
        currency: z.enum(["USD", "CAD", "EUR", "GBP"]),
      })
      .parse(b);
    this.o.ref(a, "worker", v.workerId);
    const prior = this.o.store.db
      .prepare(
        "SELECT * FROM labor_rates WHERE org=? AND worker_id=? AND effective=?",
      )
      .get(a.org, v.workerId, v.effective);
    this.o.store.db
      .prepare("INSERT INTO labor_rate_history VALUES(?,?,?,?,?,?,?,?,?)")
      .run(
        randomUUID(),
        a.org,
        v.workerId,
        v.effective,
        prior ? JSON.stringify(prior) : null,
        JSON.stringify(v),
        new Date().toISOString(),
        a.id,
        z
          .string()
          .max(3000)
          .parse(b.reason || "Recorded effective rate revision"),
      );
    this.o.store.db
      .prepare(
        "INSERT INTO labor_rates VALUES(?,?,?,?,?,?) ON CONFLICT(org,worker_id,effective) DO UPDATE SET rate=excluded.rate,overtime_multiplier=excluded.overtime_multiplier,currency=excluded.currency",
      )
      .run(
        a.org,
        v.workerId,
        v.effective,
        v.rate,
        v.overtimeMultiplier,
        v.currency,
      );
    this.o.store.audit(a, "payroll.rate_updated", v.workerId, {
      effective: v.effective,
    });
    return { ok: true };
  }
  command(a: Actor, name: string, b: any): any {
    if (name === "adapter") return saveAdapter(this.o.store, a, b);
    if (name === "adapterRetry") return retryAdapter(this.o.store, a, b);
    if (name === "vendorPromise") {
      requireThat(a.role === "vendor", "Supplier account required", 403);
      const po = this.o.ref(a, "po", z.string().parse(b.id));
      requireThat(
        ["Issued", "Acknowledged"].includes(po.status),
        "Issued PO required",
      );
      const promises = z
        .array(
          z.object({
            id: z.string(),
            confirmedETA: schemas.po.shape.lines.element.shape.confirmedETA,
            ackDate: schemas.po.shape.lines.element.shape.ackDate,
          }),
        )
        .parse(b.lines);
      requireThat(
        promises.length === po.lines.length &&
          new Set(promises.map((l) => l.id)).size === po.lines.length &&
          promises.every((l) => po.lines.some((p: any) => p.id === l.id)),
        "Confirm each PO line exactly once",
      );
      return this.o.store.update(
        a,
        "po",
        po.id,
        {
          status: "Acknowledged",
          lines: po.lines.map((l: any) => ({
            ...l,
            ...promises.find((p) => p.id === l.id),
          })),
        },
        z.number().int().parse(b.version),
      );
    }
    if (name === "price") return savePrice(this.o, a, b);
    if (name === "priceApprove") return savePrice(this.o, a, b, true);
    if (name === "demobilize") {
      this.manager(a);
      const member = this.o.ref(a, "crewMembership", b.id),
        to = date.parse(b.to);
      requireThat(to >= member.from, "Demobilization must follow mobilization");
      requireThat(
        !member.to || to <= member.to,
        "Use a new membership to extend a completed period",
      );
      return this.o.store.update(
        a,
        "crewMembership",
        member.id,
        { to },
        z.number().int().parse(b.version),
      );
    }
    if (name === "fieldSync") {
      this.o.allowed(a, "time");
      const context = z
          .object({
            assignmentId: z.string(),
            assignmentVersion: z.number().int(),
            taskVersion: z.number().int(),
          })
          .parse(b.context),
        assignment = this.o.ref(a, "assignment", context.assignmentId),
        task = this.o.ref(a, "task", assignment.taskId);
      requireThat(
        a.role !== "worker" || assignment.workerId === a.workerId,
        "Own assigned work only",
        403,
      );
      requireThat(
        assignment.status !== "Cancelled" &&
          assignment.version === context.assignmentVersion &&
          task.version === context.taskVersion,
        "Offline work package changed; review and rebase the draft",
        409,
      );
      requireThat(
        b.payload.projectId === assignment.projectId &&
          b.payload.taskId === assignment.taskId &&
          b.payload.workerId === assignment.workerId &&
          b.payload.date === assignment.date,
        "Offline draft must match the assigned work package",
        409,
      );
      const mode = z
        .enum(["fieldEntry", "production", "checkin"])
        .parse(b.mode);
      const result =
        mode === "fieldEntry"
          ? this.command(a, "fieldEntry", b.payload)
          : this.o.create(a, mode, b.payload);
      this.o.store.audit(a, "offline.synced", assignment.id, {
        mode,
        assignmentVersion: assignment.version,
        taskVersion: task.version,
      });
      return result;
    }
    if (name === "fieldEntry") {
      const time = this.o.create(a, "time", b);
      const quantity = z
        .number()
        .min(0)
        .max(1e9)
        .parse(b.quantity ?? 0);
      const production = quantity
        ? this.o.create(a, "production", {
            projectId: time.projectId,
            taskId: time.taskId,
            workerId: time.workerId,
            timeId: time.id,
            date: time.date,
            quantity,
            unit: b.unit,
            notes: b.notes,
          })
        : null;
      return { time, production };
    }
    if (name === "grants") return this.grants(a, b);
    if (name === "publish") return this.publish(a, b);
    if (name === "assetMove") return this.assetMove(a, b.id, b);
    if (name === "quoteToPo") return this.quoteToPo(a, b.id, b);
    if (name === "shortageRfqs") return this.shortageRfqs(a, b);
    if (name === "workerReview") return this.workerReview(a, b.id, b);
    if (name === "timer") return this.timer(a, b);
    if (name === "cancelTimer") {
      const t = this.o.ref(a, "timer", b.id);
      this.o.allowed(a, "time");
      requireThat(
        t.status === "Running",
        "Only a running timer can be cancelled",
      );
      requireThat(
        a.role !== "worker" || a.workerId === t.workerId,
        "Own timer only",
        403,
      );
      return this.o.store.update(
        a,
        "timer",
        t.id,
        { status: "Cancelled", reason: z.string().min(5).parse(b.reason) },
        b.version,
      );
    }
    if (name === "rate") return this.rates(a, b);
    if (name === "backorder") {
      this.o.allowed(a, "po");
      const po = this.o.ref(a, "po", b.id);
      requireThat(
        ["Issued", "Acknowledged"].includes(po.status),
        "Issue the PO before recording backorders",
      );
      const line = po.lines.find((l: any) => l.id === b.lineId);
      requireThat(line, "Line not found");
      const quantity = z.number().min(0).parse(b.quantity);
      requireThat(
        quantity <= line.quantity - this.o.receiptTotal(a, po.id, line.id),
        "Backorder exceeds remaining quantity",
      );
      return this.o.store.update(
        a,
        "po",
        po.id,
        {
          lines: po.lines.map((l: any) =>
            l.id === line.id
              ? {
                  ...l,
                  backordered: quantity,
                  backorderReason: z.string().min(3).parse(b.reason),
                }
              : l,
          ),
        },
        b.version,
      );
    }
    if (name === "retryEvent") {
      this.admin(a);
      const e = this.o.store.db
        .prepare("SELECT id FROM outbox WHERE org=? AND id=?")
        .get(a.org, b.id);
      requireThat(e, "Event not found", 404);
      this.o.store.db
        .prepare(
          "UPDATE outbox SET state='pending',attempts=0,next_at=0 WHERE id=? AND org=?",
        )
        .run(b.id, a.org);
      return { ok: true };
    }
    if (name === "dispatchSetting") {
      this.admin(a);
      const settings = this.o.all(a, "settings")[0];
      return this.o.store.update(
        a,
        "settings",
        settings.id,
        { dispatch: z.boolean().parse(b.enabled) },
        b.version,
      );
    }
    requireThat(false, "Unknown operation", 404);
  }
}
