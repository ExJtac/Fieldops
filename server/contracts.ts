import type { RecordData as R } from "./store.js";
export const domainEvents = [
  "MaterialReceiptRecorded",
  "TaskMaterialsBecameReady",
  "TaskMaterialReadinessChanged",
  "CrewAssignmentChanged",
  "TimeEntryApproved",
  "ProjectQuantityInstalled",
  "SupplierPromiseChanged",
  "ProjectProgressChanged",
  "ProjectTaskChanged",
] as const;
export function eventContract(kind: string, r: R, action: string, old?: R) {
  let type = kind + "." + action;
  const data: Record<string, any> = {
    projectId: r.projectId || null,
    taskId: r.taskId || null,
    workerId: r.workerId || null,
    version: r.version,
    status: r.status || null,
    date: r.date || null,
    hours: r.hours ?? null,
  };
  if (kind === "movement" && r.action === "receive") {
    type = "MaterialReceiptRecorded";
    Object.assign(data, {
      partId: r.partId,
      poId: r.poId,
      lineId: r.lineId,
      quantity: r.quantity,
      usableQuantity: r.stock,
      locationId: r.locationId,
      condition: r.condition || "Accepted",
    });
  }
  if (kind === "assignment") {
    type = "CrewAssignmentChanged";
    Object.assign(data, {
      start: r.start,
      crewId: r.crewId || null,
      plannedQuantity: r.plannedQuantity ?? null,
    });
  }
  if (
    kind === "time" &&
    r.status === "Approved" &&
    old?.status !== "Approved"
  ) {
    type = "TimeEntryApproved";
    Object.assign(data, {
      regular: r.regular,
      overtime: r.overtime,
      costCodeId: r.costCodeId || null,
    });
  }
  if (
    kind === "production" &&
    r.status === "Approved" &&
    (old?.status !== "Approved" || old?.quantity !== r.quantity)
  ) {
    type = "ProjectQuantityInstalled";
    Object.assign(data, {
      quantity: r.quantity,
      previousApprovedQuantity: old?.status === "Approved" ? old.quantity : 0,
      unit: r.unit,
      crew: r.crewAtEntry || null,
    });
  }
  const promises = (p: R) =>
    p.lines?.map((l: R) => ({
      id: l.id,
      partId: l.partId,
      confirmedETA: l.confirmedETA || "",
      ackDate: l.ackDate || "",
      leadMin: l.leadMin || 0,
      leadMax: l.leadMax || 0,
    }));
  if (
    kind === "po" &&
    old &&
    JSON.stringify(promises(r)) !== JSON.stringify(promises(old))
  ) {
    type = "SupplierPromiseChanged";
    Object.assign(data, {
      poId: r.id,
      supplierId: r.supplierId,
      lines: promises(r),
    });
  }
  if (kind === "task") {
    type = "ProjectTaskChanged";
    Object.assign(data, {
      taskId: r.id,
      unit: r.unit,
      target: r.target,
      baselineStart: r.baselineStart,
      baselineEnd: r.baselineEnd,
      forecastStart: r.forecastStart || "",
      forecastEnd: r.forecastEnd || "",
      released: r.released,
    });
  }
  return { type, data };
}
