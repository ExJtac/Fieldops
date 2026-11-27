import {
  Store,
  type Actor,
  type RecordData as R,
  requireThat,
} from "./store.js";
export function projectIds(s: Store, a: Actor): Set<string> | null {
  if (a.role === "admin") return null;
  const ids = new Set(
    (
      s.db
        .prepare(
          "SELECT project_id FROM project_access WHERE org=? AND user_id=?",
        )
        .all(a.org, a.id) as any[]
    ).map((r) => r.project_id),
  );
  if (a.role === "worker" && a.workerId)
    for (const row of s.list(a.org, "assignment"))
      if (row.workerId === a.workerId && row.status !== "Cancelled")
        ids.add(row.projectId);
  return ids;
}
export function projectAccess(s: Store, a: Actor, id: string) {
  const scope = projectIds(s, a);
  requireThat(!scope || scope.has(id), "Project access denied", 403);
}
export function payrollAccess(s: Store, a: Actor) {
  return !!s.db
    .prepare(
      "SELECT 1 FROM financial_access WHERE org=? AND user_id=? AND payroll=1",
    )
    .get(a.org, a.id);
}
export function filterRecords(
  s: Store,
  a: Actor,
  kind: string,
  rows: R[],
): R[] {
  const scope = projectIds(s, a);
  if (scope === null) return rows;
  if (kind === "project") return rows.filter((r) => scope.has(r.id));
  if (["worker", "leave", "calendar"].includes(kind)) {
    if (a.role === "worker")
      return rows.filter(
        (r) => (kind === "worker" ? r.id : r.workerId) === a.workerId,
      );
    const workers = new Set(
      s
        .list(a.org, "assignment")
        .filter((r) => scope.has(r.projectId))
        .map((r) => r.workerId),
    );
    if (a.role === "pm") return rows; // staffing directory; no payroll/personal data
    return rows.filter((r) =>
      workers.has(kind === "worker" ? r.id : r.workerId),
    );
  }
  if (a.role === "worker" && ["time", "timer", "checkin"].includes(kind))
    return rows.filter(
      (r) => r.workerId === a.workerId && scope.has(r.projectId),
    );
  if (kind === "calendar" && a.role === "worker")
    return rows.filter((r) => r.workerId === a.workerId);
  if (kind === "notice")
    return rows.filter(
      (r) => r.recipientId === a.id && (!r.projectId || scope.has(r.projectId)),
    );
  if (kind === "settings")
    return rows.map(
      (r) =>
        ({
          ...r,
          separation: r.separation,
          dispatch: r.dispatch,
          publicDemo: undefined,
        }) as R,
    );
  return rows.filter((r) => !r.projectId || scope.has(r.projectId));
}
