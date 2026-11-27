import { Operations, addDays } from "./domain.js";
import { type Actor, requireThat } from "./store.js";
import { crewName } from "./crews.js";
import { date } from "./schemas.js";
type R = Record<string, any>;
export function workforceData(
  o: Operations,
  a: Actor,
  scope: { project?: string; from: string; to: string; section?: string },
) {
  requireThat(
    !["worker", "viewer"].includes(a.role),
    "Operations staff only",
    403,
  );
  const from = date.parse(scope.from),
    to = date.parse(scope.to);
  requireThat(
    to >= from && to <= addDays(from, 366),
    "Use a workforce range of up to one year",
  );
  if (scope.project) o.ref(a, "project", scope.project);
  const tasks = o
      .all(a, "task")
      .filter(
        (t) =>
          (!scope.project || t.projectId === scope.project) &&
          (!scope.section || t.section === scope.section),
      ),
    ids = new Set(tasks.map((t) => t.id));
  const assignments = o
    .all(a, "assignment")
    .filter(
      (x) =>
        ids.has(x.taskId) &&
        x.date >= from &&
        x.date <= to &&
        x.status !== "Cancelled",
    );
  const times = o
    .all(a, "time")
    .filter(
      (x) =>
        ids.has(x.taskId) &&
        x.date >= from &&
        x.date <= to &&
        ["Approved", "Locked", "Correction requested"].includes(x.status),
    );
  const production = o
    .all(a, "production")
    .filter(
      (x) =>
        ids.has(x.taskId) &&
        x.date >= from &&
        x.date <= to &&
        x.status === "Approved",
    );
  const trends = new Map<string, R>();
  function trend(r: R) {
    const task = tasks.find((t) => t.id === r.taskId)!,
      crew =
        r.crewAtEntry ??
        (r.workerId ? crewName(o.store, a, r.workerId, r.date) : "");
    const key = JSON.stringify([r.date, r.taskId, crew]);
    if (!trends.has(key))
      trends.set(key, {
        date: r.date,
        project: o.ref(a, "project", r.projectId).name,
        task: task.name,
        section: task.section,
        crew: crew || "Unattributed crew",
        unit: task.unit,
        hours: 0,
        quantity: 0,
        earnedHours: 0,
      });
    return trends.get(key)!;
  }
  for (const r of times) trend(r).hours += r.regular + r.overtime;
  for (const r of production) {
    const row = trend(r);
    row.quantity += r.quantity;
    row.earnedHours += r.quantity * o.ref(a, "task", r.taskId).unitHours;
  }
  const productivity = [...trends.values()].map((r) => ({
    ...r,
    unitsPerHour: r.hours ? r.quantity / r.hours : null,
    earnedPerActualHour: r.hours ? r.earnedHours / r.hours : null,
    context:
      r.crew === "Unattributed crew"
        ? "Crew attribution missing; do not compare to named crews"
        : "Approved quantities and approved/locked hours; no employee ranking",
  }));
  const groups = new Map<string, R>();
  for (const r of assignments) {
    const w = o.ref(a, "worker", r.workerId),
      p = o.ref(a, "project", r.projectId),
      crew = crewName(o.store, a, w.id, r.date),
      key = JSON.stringify([r.date, p.id, w.trade, crew]);
    if (!groups.has(key))
      groups.set(key, {
        date: r.date,
        project: p.name,
        trade: w.trade,
        crew: crew || "Unassigned crew",
        workers: new Set(),
        plannedHours: 0,
        conflicts: 0,
      });
    const g = groups.get(key)!;
    g.workers.add(w.id);
    g.plannedHours += r.hours;
    g.conflicts += o.assignmentConflicts(a, r, r.id).length ? 1 : 0;
  }
  const headcount: R[] = [...groups.values()].map(({ workers, ...g }) => ({
    ...g,
    headcount: workers.size,
  }));
  const bottlenecks = assignments.flatMap((r) => {
    const reasons = o.assignmentConflicts(a, r, r.id);
    return reasons.length
      ? [
          {
            date: r.date,
            project: o.ref(a, "project", r.projectId).name,
            task: o.ref(a, "task", r.taskId).name,
            crew: crewName(o.store, a, r.workerId, r.date) || "Unassigned crew",
            plannedHours: r.hours,
            exceptions: reasons.join("; "),
            override: r.override || "",
            assignmentId: r.id,
          },
        ]
      : [];
  });
  const skillCoverage = tasks.flatMap((t) => {
    if (!t.requiredSkill) return [];
    const days = [
      ...new Set(
        assignments.filter((r) => r.taskId === t.id).map((r) => r.date),
      ),
    ];
    return days.map((day) => {
      const workers = [
          ...new Set(
            assignments
              .filter((r) => r.taskId === t.id && r.date === day)
              .map((r) => r.workerId),
          ),
        ].map((id) => o.ref(a, "worker", id)),
        qualified = workers.filter((w) =>
          w.skills.some(
            (s: R) =>
              s.name.toLowerCase() === t.requiredSkill.toLowerCase() &&
              (!s.expires || s.expires >= day),
          ),
        );
      return {
        date: day,
        project: o.ref(a, "project", t.projectId).name,
        task: t.name,
        requiredSkill: t.requiredSkill,
        scheduledHeadcount: workers.length,
        qualifiedHeadcount: qualified.length,
        unqualifiedHeadcount: workers.length - qualified.length,
      };
    });
  });
  const crewCapacity: R[] = [];
  const project = scope.project ? o.ref(a, "project", scope.project) : null;
  if (project)
    for (let day = from; day <= to; day = addDays(day, 1)) {
      const grouped = new Map<string, R>();
      for (const w of o.all(a, "worker").filter((w) => w.active)) {
        const crew = crewName(o.store, a, w.id, day) || "Unassigned crew",
          g = grouped.get(crew) || {
            date: day,
            crew,
            headcount: 0,
            capacity: 0,
            plannedHere: 0,
            plannedAllJobs: 0,
          };
        g.headcount++;
        g.capacity += o.workerCapacity(a, project, w, day);
        g.plannedHere += assignments
          .filter((r) => r.workerId === w.id && r.date === day)
          .reduce((n, r) => n + r.hours, 0);
        g.plannedAllJobs += o.store
          .list(a.org, "assignment")
          .filter(
            (r) =>
              r.workerId === w.id && r.date === day && r.status !== "Cancelled",
          )
          .reduce((n, r) => n + r.hours, 0);
        grouped.set(crew, g);
      }
      crewCapacity.push(
        ...[...grouped.values()].map((g) => ({
          ...g,
          remaining: Math.max(0, g.capacity - g.plannedAllJobs),
          overallocated: Math.max(0, g.plannedAllJobs - g.capacity),
        })),
      );
    }
  return {
    CrewProductivity: productivity,
    TradeSiteHeadcount: headcount,
    StaffingBottlenecks: bottlenecks,
    SkillCoverage: skillCoverage,
    CrewCapacity: crewCapacity,
  };
}

// The board and assignment validator use the same dated calendars and private leave balances.
export function resourceAvailability(
  o: Operations,
  a: Actor,
  scope: { project?: string; from: string; to: string },
) {
  requireThat(
    !["vendor", "viewer"].includes(a.role),
    "Resource access required",
    403,
  );
  const from = date.parse(scope.from),
    to = date.parse(scope.to);
  requireThat(
    to >= from && to <= addDays(from, 31),
    "Use a resource range of up to 32 days",
  );
  const projects = o.all(a, "project");
  if (scope.project) o.ref(a, "project", scope.project);
  const assignments = o.all(a, "assignment");
  const result: R[] = [];
  for (const worker of o.all(a, "worker"))
    for (let day = from; day <= to; day = addDays(day, 1)) {
      const here = assignments.filter(
        (x) =>
          x.workerId === worker.id &&
          x.date === day &&
          x.status !== "Cancelled" &&
          (!scope.project || x.projectId === scope.project),
      );
      const project =
        projects.find((p) => p.id === (scope.project || here[0]?.projectId)) ||
        projects[0];
      const plannedAllJobs = o.store
        .list(a.org, "assignment")
        .filter(
          (x) =>
            x.workerId === worker.id &&
            x.date === day &&
            x.status !== "Cancelled",
        )
        .reduce((n, x) => n + x.hours, 0);
      result.push({
        workerId: worker.id,
        date: day,
        crew: crewName(o.store, a, worker.id, day),
        capacity: project ? o.workerCapacity(a, project, worker, day) : 0,
        plannedAllJobs,
      });
    }
  return result;
}
