import { Operations } from "./domain.js";
import { type Actor, requireThat } from "./store.js";
export function seed(ops: Operations, a: Actor) {
  requireThat(a.role === "admin", "Administrator required", 403);
  requireThat(
    !ops.all(a, "project").length,
    "Demo can only be loaded into an empty workspace",
  );
  const project = ops.create(a, "project", {
    name: "EPCC · Valle Verde",
    customer: "Demonstration project — synthetic records",
    fieldBudget: 1793.95,
    pmBudget: 179.395,
    holidays: ["2026-11-26", "2026-11-27", "2026-12-25"],
    notes:
      "Source: user-provided tracking specification. Section 1 labor allocation is unassigned. Future sections await GC release.",
  });
  const other = ops.create(a, "project", {
    name: "Westside · Service work",
    customer: "Demonstration project",
    fieldBudget: 120,
    pmBudget: 12,
  });
  const tasks = [
    [
      "conduit",
      "Install 33 conduit stubouts",
      33,
      1.5,
      "2026-12-01",
      "2026-12-04",
    ],
    ["cable", "Install 33 blue CAT6A drops", 33, 2, "2026-12-07", "2026-12-11"],
    ["managers", "Install vertical managers", 2, 3, "2026-12-15", "2026-12-16"],
    [
      "tray",
      "Install 24-inch cable tray",
      100,
      0.25,
      "2026-12-17",
      "2026-12-21",
    ],
  ].map(([key, name, target, unitHours, start, end]) =>
    ops.store.add(
      a,
      "task",
      {
        ...{
          projectId: project.id,
          name,
          section: "Section 1",
          unit: "ea",
          target,
          unitHours,
          baselineStart: start,
          baselineEnd: end,
          requiredSkill: "Low voltage",
          released: true,
          notes: "Illustrative approved standard and dates for demo only.",
          laborType: "field",
        },
      },
      String(key),
    ),
  );
  for (let i = 2; i <= 5; i++)
    ops.create(a, "task", {
      projectId: project.id,
      name: "Scope pending GC release",
      section: `Section ${i}`,
      released: false,
      notes: "Scope and quantities not yet allocated.",
    });
  const service = ops.create(a, "task", {
    projectId: other.id,
    name: "Service installations",
    section: "General",
    target: 20,
    unit: "ea",
  });
  const parts = [
    ["EMT-STUB", "Conduit stubout kit", "ea"],
    ["CAT6A-BL", "Blue CAT6A drop assembly", "ea"],
    ["VM-10", "10-inch vertical manager", "ea"],
    ["TRAY-24X4", "24 × 4-inch cable tray section", "ea"],
  ].map(([partNumber, description, unit]) =>
    ops.create(a, "part", {
      partNumber,
      description,
      unit,
      manufacturer: "Demo catalog",
      aliases: partNumber === "CAT6A-BL" ? ["BLUE-CAT6A", "CAT6A-BLUE"] : [],
    }),
  );
  const location = ops.create(a, "location", {
    name: "Valle Verde · Site storage",
    bin: "A-01",
  });
  ops.create(a, "location", { name: "Main warehouse", bin: "Receiving" });
  const supplier = ops.create(a, "supplier", {
    name: "ADI · Demo supplier",
    notes:
      "Mixed lead times are illustrative. No real purchase order or supplier promise is asserted.",
  });
  tasks.forEach((task, i) =>
    ops.create(a, "requirement", {
      projectId: project.id,
      taskId: task.id,
      partId: parts[i].id,
      quantity: [33, 33, 2, 100][i],
      needBy: task.baselineStart,
      source: "Tracking specification / illustrative fixture",
      sourceVersion: "demo-v1",
    }),
  );
  const po = ops.create(a, "po", {
    projectId: project.id,
    supplierId: supplier.id,
    number: "DEMO-001",
    notes:
      "Synthetic order. Twelve-inch versus 24-inch tray must be reconciled before a real purchase.",
    lines: parts.map((p, i) => ({
      partId: p.id,
      quantity: [33, 100, 2, 100][i],
      unitCost: [18, 42, 220, 95][i],
      leadMin: [5, 20, 30, 95][i],
      leadMax: [10, 20, 35, 95][i],
      ackDate: "",
      confirmedETA: "",
    })),
  });
  let approved = ops.transition(a, "po", po.id, {
    status: "Submitted",
    version: po.version,
  });
  approved = ops.transition(a, "po", po.id, {
    status: "Approved",
    version: approved.version,
  });
  ops.transition(a, "po", po.id, {
    status: "Issued",
    version: approved.version,
  });
  ops.movement(a, {
    action: "receive",
    partId: parts[1].id,
    locationId: location.id,
    projectId: project.id,
    poId: po.id,
    lineId: po.lines[1].id,
    quantity: 60,
    note: "Synthetic partial receipt: 60 of 100 units",
  });
  ops.movement(a, {
    action: "reserve",
    partId: parts[1].id,
    locationId: location.id,
    projectId: project.id,
    taskId: tasks[1].id,
    quantity: 33,
    note: "Reserve Section 1 demo drops",
  });
  ops.create(a, "hold", {
    projectId: project.id,
    taskId: tasks[1].id,
    reason: "Temporary support method requires approval before installation.",
  });
  ops.create(a, "hold", {
    projectId: project.id,
    taskId: tasks[3].id,
    reason:
      "Reconcile 12-inch quoted tray against requested 24 × 4-inch tray. ETA remains unconfirmed.",
  });
  const workers = [
    "Alex Rivera",
    "Morgan Lee",
    "Jordan Cruz",
    "Taylor Reed",
  ].map((name) =>
    ops.create(a, "worker", {
      name: name + " (demo)",
      trade: "Low voltage",
      crew: "Crew A",
      dailyHours: 8,
      skills: [{ name: "Low voltage", expires: "2027-12-31" }],
    }),
  );
  workers.forEach((w) =>
    ops.create(a, "assignment", {
      projectId: project.id,
      taskId: tasks[0].id,
      workerId: w.id,
      date: "2026-12-01",
      start: 7,
      hours: 8,
    }),
  );
  const time = ops.create(a, "time", {
    projectId: project.id,
    taskId: tasks[0].id,
    workerId: workers[0].id,
    date: "2026-11-25",
    regular: 8,
    notes: "Synthetic submitted timecard for approval demonstration",
  });
  ops.transition(a, "time", time.id, {
    status: "Submitted",
    version: time.version,
  });
  ops.create(a, "production", {
    projectId: project.id,
    taskId: tasks[0].id,
    date: "2026-11-25",
    quantity: 8,
    unit: "ea",
    notes: "Synthetic production awaiting review",
  });
  return {
    projectId: project.id,
    otherProjectId: other.id,
    serviceTaskId: service.id,
  };
}
