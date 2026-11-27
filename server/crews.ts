import type { Store, Actor, RecordData as R } from "./store.js";
export function effectiveCrew(
  s: Store,
  a: Actor,
  workerId: string,
  day: string,
) {
  const member = s
    .list(a.org, "crewMembership")
    .find(
      (m) =>
        m.workerId === workerId &&
        m.from <= day &&
        (!m.to || m.to >= day) &&
        m.status !== "Cancelled",
    );
  return member ? { member, crew: s.get(a.org, "crew", member.crewId) } : null;
}
export function effectiveCalendar(
  s: Store,
  a: Actor,
  workerId: string,
  day: string,
): R | undefined {
  const worker = s.list(a.org, "calendar").find((c) => c.workerId === workerId),
    crew = effectiveCrew(s, a, workerId, day)?.crew;
  if (!worker) return crew;
  if (!crew) return worker;
  const start = Math.max(worker.shiftStart, crew.shiftStart),
    end = Math.min(
      worker.shiftStart + worker.shiftHours,
      crew.shiftStart + crew.shiftHours,
    );
  return {
    ...worker,
    shiftStart: start,
    shiftHours: Math.max(0, end - start),
    unpaidBreak: Math.max(worker.unpaidBreak, crew.unpaidBreak),
    paidBreak: Math.max(worker.paidBreak || 0, crew.paidBreak || 0),
    workdays: worker.workdays.filter((d: number) => crew.workdays.includes(d)),
    holidays: [...worker.holidays, ...crew.holidays],
    weeklyLimit: Math.min(worker.weeklyLimit, crew.weeklyLimit),
    overtimeAllowed: worker.overtimeAllowed && crew.overtimeAllowed,
  };
}
export function crewName(s: Store, a: Actor, workerId: string, day: string) {
  return (
    effectiveCrew(s, a, workerId, day)?.crew.name ||
    s.get(a.org, "worker", workerId).crew ||
    ""
  );
}
