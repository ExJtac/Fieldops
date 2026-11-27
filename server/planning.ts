import { z } from "zod";
import { Operations, addDays } from "./domain.js";
import {
  type Actor,
  type RecordData as R,
  requireThat,
  hash,
} from "./store.js";
import { schemas, date } from "./schemas.js";
const rangeSchema = z.object({
  projectId: z.string(),
  taskId: z.string(),
  workerIds: z.array(z.string()).min(1).max(100),
  from: date,
  to: date,
  start: z.number().min(0).max(23),
  hours: z.number().positive().max(16),
  role: z.string().default(""),
  priority: z.number().int().min(1).max(5).default(3),
  allocation: z.number().min(1).max(100).default(100),
  override: z.string().default(""),
});
export class Planning {
  constructor(public o: Operations) {}
  range(a: Actor, raw: any, save = false) {
    this.o.allowed(a, "assignment");
    const b = rangeSchema.parse(raw);
    requireThat(
      b.to >= b.from && b.to <= addDays(b.from, 730),
      "Schedule up to two years per range",
    );
    requireThat(
      new Set(b.workerIds).size === b.workerIds.length,
      "Duplicate workers",
    );
    const p = this.o.ref(a, "project", b.projectId);
    this.o.validateRefs(a, b);
    const records: any[] = [],
      skipped: any[] = [];
    for (let d = b.from; d <= b.to; d = addDays(d, 1))
      for (const id of b.workerIds) {
        const w = this.o.ref(a, "worker", id);
        if (this.o.workerCapacity(a, p, w, d) <= 0) {
          skipped.push({
            date: d,
            workerId: id,
            reason: "Non-working day / leave",
          });
          continue;
        }
        const row = schemas.assignment.parse({ ...b, date: d, workerId: id });
        const conflicts = this.o.assignmentConflicts(a, row);
        if (!save) {
          const cal = this.o.store
              .list(a.org, "calendar")
              .find((c) => c.workerId === id),
            weekStart = addDays(
              d,
              -((new Date(d + "T00:00:00Z").getUTCDay() + 6) % 7),
            );
          if (cal && !cal.overtimeAllowed) {
            const total =
              [...this.o.store.list(a.org, "assignment"), ...records]
                .filter(
                  (x) =>
                    x.workerId === id &&
                    x.status !== "Cancelled" &&
                    x.date >= weekStart &&
                    x.date < addDays(weekStart, 7),
                )
                .reduce((n, x) => n + x.hours, 0) + row.hours;
            if (
              total > cal.weeklyLimit &&
              !conflicts.includes("Weekly limit requires authorized overtime")
            )
              conflicts.push("Weekly limit requires authorized overtime");
          }
        }
        if (save) records.push(this.o.create(a, "assignment", row));
        else records.push({ ...row, conflicts });
      }
    return { records, skipped, count: records.length };
  }
  // Suggestions only move dated assignments; no worker scoring or silent schedule edits.
  level(a: Actor, raw: any) {
    this.o.allowed(a, "assignment");
    const b = z
      .object({ projectId: z.string(), from: date, to: date })
      .parse(raw);
    this.o.ref(a, "project", b.projectId);
    requireThat(
      b.to >= b.from && b.to <= addDays(b.from, 730),
      "Use a range of up to two years",
    );
    const assignments = this.o
      .all(a, "assignment")
      .filter(
        (x) =>
          x.projectId === b.projectId &&
          x.status !== "Cancelled" &&
          x.date >= b.from &&
          x.date <= b.to,
      )
      .sort(
        (x, y) =>
          (x.priority || 3) - (y.priority || 3) || x.date.localeCompare(y.date),
      );
    const suggestions: any[] = [];
    const accepted: any[] = [];
    for (const r of assignments) {
      const conflicts = this.o.assignmentConflicts(a, r, r.id);
      if (!conflicts.length) continue;
      let chosen: any = null;
      for (let offset = 1; offset <= 60; offset++) {
        const day = addDays(r.date, offset);
        if (day > b.to) break;
        const v: any = { ...r, date: day, override: "" };
        if (this.o.assignmentConflicts(a, v, r.id).length) continue;
        if (
          accepted.some(
            (x) =>
              x.workerId === v.workerId &&
              x.date === day &&
              x.start < v.start + v.hours &&
              v.start < x.start + x.hours,
          )
        )
          continue;
        chosen = v;
        break;
      }
      if (chosen) accepted.push(chosen);
      suggestions.push({
        id: r.id,
        version: r.version,
        before: { date: r.date, start: r.start, hours: r.hours },
        after: chosen
          ? { date: chosen.date, start: chosen.start, hours: chosen.hours }
          : null,
        workerId: r.workerId,
        taskId: r.taskId,
        reasons: conflicts,
      });
    }
    const token = hash(JSON.stringify(suggestions));
    return { projectId: b.projectId, suggestions, token };
  }
  apply(a: Actor, b: any) {
    const preview = this.level(a, b);
    requireThat(
      preview.token === b.token,
      "Assignments changed; preview leveling again",
      409,
    );
    const selected = z.array(z.string()).min(1).parse(b.selected);
    const moves = preview.suggestions.filter((s) => selected.includes(s.id));
    requireThat(
      moves.length === new Set(selected).size && moves.every((s) => s.after),
      "Choose feasible suggestions",
    );
    const rows = moves.map((s) => {
      const r = this.o.ref(a, "assignment", s.id);
      const next = this.o.moveAssignment(a, r.id, {
        ...r,
        ...s.after,
        version: s.version,
        override: "",
      });
      return { ...s, appliedVersion: next.version };
    });
    return this.o.store.add(a, "leveling", {
      projectId: b.projectId,
      status: "Applied",
      moves: rows,
    });
  }
  undo(a: Actor, b: any) {
    this.o.allowed(a, "assignment");
    const batch = this.o.ref(a, "leveling", b.id);
    requireThat(
      batch.status === "Applied" && batch.version === b.version,
      "Leveling batch changed",
      409,
    );
    for (const m of batch.moves) {
      const r = this.o.ref(a, "assignment", m.id);
      requireThat(
        r.version === m.appliedVersion,
        "An assignment changed since leveling; undo cannot overwrite it",
        409,
      );
      this.o.store.update(
        a,
        "assignment",
        r.id,
        {
          ...m.before,
          override: "Restored reviewed pre-leveling schedule",
          conflicts: this.o.assignmentConflicts(a, { ...r, ...m.before }, r.id),
        },
        r.version,
      );
    }
    return this.o.store.update(
      a,
      "leveling",
      batch.id,
      { status: "Undone" },
      batch.version,
    );
  }
  scenario(a: Actor, raw: any) {
    this.o.allowed(a, "assignment");
    const b = z
      .object({
        projectId: z.string(),
        taskId: z.string(),
        start: date,
        crew: z.number().int().min(1).max(100),
        hours: z.number().positive().max(16),
        saturdays: z.boolean().default(false),
        rate: z.number().min(0).default(0),
        overtimeMultiplier: z.number().min(1).max(5).default(1.5),
      })
      .parse(raw);
    this.o.validateRefs(a, b);
    const p = this.o.ref(a, "project", b.projectId),
      t = this.o.ref(a, "task", b.taskId),
      f = this.o.forecast(a, p.id).find((f) => f.taskId === t.id)!;
    const constraints: string[] = [];
    if (f.remaining === null)
      constraints.push("Approve an explicit remaining-hours reforecast");
    if (!t.released) constraints.push("Section not released");
    for (const h of this.o
      .all(a, "hold")
      .filter(
        (h) =>
          h.taskId === t.id && !["Rejected", "Resolved"].includes(h.status),
      ))
      constraints.push("Hold: " + h.reason);
    let earliest = b.start;
    for (const id of t.dependencies || []) {
      const dep = this.o.ref(a, "task", id),
        df = this.o.forecast(a, p.id).find((x) => x.taskId === id)!;
      if (df.installed < df.target) {
        if (dep.forecastEnd)
          earliest =
            earliest > addDays(dep.forecastEnd, 1)
              ? earliest
              : addDays(dep.forecastEnd, 1);
        else constraints.push("Dependency finish unconfirmed: " + dep.name);
      }
    }
    const readiness = this.o.readiness(a, p.id).find((r) => r.taskId === t.id)!;
    if (!readiness.lines.length && t.materialRequired !== false)
      constraints.push("Material scope not confirmed");
    for (const line of readiness.lines as R[]) {
      if (!line.shortage) continue;
      const orders = this.o
        .all(a, "po")
        .filter(
          (o) =>
            o.projectId === p.id &&
            ["Issued", "Acknowledged"].includes(o.status),
        )
        .flatMap((o) =>
          o.lines
            .filter((l: any) => l.partId === line.partId)
            .map((l: any) => ({
              ...l,
              remaining: l.quantity - this.o.receiptTotal(a, o.id, l.id),
            })),
        )
        .filter((l: any) => l.remaining > 0 && l.confirmedETA)
        .sort((x: any, y: any) => x.confirmedETA.localeCompare(y.confirmedETA));
      let remaining = line.shortage;
      for (const l of orders) {
        remaining -= l.remaining;
        const stage = addDays(l.confirmedETA, p.stagingDays ?? 2);
        if (stage > earliest) earliest = stage;
        if (remaining <= 0) break;
      }
      if (remaining > 0)
        constraints.push("Unconfirmed material coverage: " + line.partNumber);
    }
    for (const id of t.equipmentIds || []) {
      const eq = this.o.ref(a, "equipment", id);
      if (!eq.availableFrom)
        constraints.push("Equipment availability unconfirmed: " + eq.name);
      else if (eq.availableFrom > earliest) earliest = eq.availableFrom;
    }
    let remaining = f.remaining ?? 0,
      finish: string | null = null,
      days = 0,
      regular = 0,
      overtime = 0;
    if (!constraints.length) {
      for (
        let day = earliest;
        remaining > 1e-6 && day <= addDays(earliest, 730);
        day = addDays(day, 1)
      ) {
        const wd = new Date(day + "T00:00:00Z").getUTCDay();
        if (
          (!p.workdays.includes(wd) && !(b.saturdays && wd === 6)) ||
          [...(p.holidays || []), ...(p.closures || [])].includes(day)
        )
          continue;
        const used = Math.min(remaining, b.crew * b.hours);
        regular += Math.min(used, b.crew * 8);
        overtime += Math.max(0, used - b.crew * 8);
        remaining -= used;
        days++;
        finish = day;
      }
      if (remaining > 1e-6)
        constraints.push("Work exceeds the two-year simulation horizon");
      for (const id of t.equipmentIds || []) {
        const eq = this.o.ref(a, "equipment", id);
        if (finish && eq.availableUntil && finish > eq.availableUntil)
          constraints.push(
            "Equipment window ends before completion: " + eq.name,
          );
      }
    }
    return {
      taskId: t.id,
      crew: b.crew,
      start: constraints.length ? null : earliest,
      finish: constraints.length ? null : finish,
      days,
      regular,
      overtime,
      modeledCost: regular * b.rate + overtime * b.rate * b.overtimeMultiplier,
      constraints,
      assumptions: [
        "Crew availability is modeled, not reserved.",
        "Overtime model: hours beyond 8 per worker per day; validate payroll policy separately.",
        "Confirmed deliveries still require receipt and allocation before readiness.",
      ],
      saved: false,
    };
  }
  template(a: Actor, b: any) {
    this.o.allowed(a, "worker");
    date.parse(b.date);
    const t = this.o.ref(a, "crewTemplate", b.id),
      crew = z.string().trim().min(1).parse(b.crew),
      ids = z.array(z.string()).parse(b.workerIds);
    requireThat(
      ids.length === t.size && new Set(ids).size === ids.length,
      "Choose exactly the template crew size",
    );
    const workers = ids.map((id) => this.o.ref(a, "worker", id));
    requireThat(
      workers.every((w) => w.active && w.trade === t.trade),
      "Choose active workers with matching trade",
    );
    const slots = t.roles.flatMap((r: any) =>
      Array.from({ length: r.count }, () => r),
    );
    const remaining = [...workers];
    const allocation: any[] = [];
    for (const role of slots.sort(
      (x: any, y: any) => Number(!!y.skill) - Number(!!x.skill),
    )) {
      const index = remaining.findIndex(
        (w) =>
          !role.skill ||
          w.skills.some(
            (s: any) =>
              s.name === role.skill && (!s.expires || s.expires >= b.date),
          ),
      );
      requireThat(
        index >= 0,
        "Template certification requirement is not satisfied",
      );
      const w = remaining.splice(index, 1)[0];
      allocation.push(
        this.o.store.update(
          a,
          "worker",
          w.id,
          { crew, crewRole: role.role },
          w.version,
        ),
      );
    }
    return { workers: allocation };
  }
}
