import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import { Store, type Actor } from "../server/store.js";
import { Operations } from "../server/domain.js";
import { Advanced } from "../server/advanced.js";
import { Planning } from "../server/planning.js";
import { previewImport, commitImport } from "../server/imports.js";
import { processEvents } from "../server/events.js";
import { reportData, renderReport } from "../server/reports.js";
function fixture() {
  const s = new Store(":memory:");
  s.db.prepare("INSERT INTO organizations VALUES(?,?)").run("org", "Test");
  const a = s.createUser(
      "org",
      "admin@test.invalid",
      "Admin",
      "test-only-long-password",
      "admin",
    ),
    o = new Operations(s),
    v = new Advanced(o),
    planning = new Planning(o);
  s.add(a, "settings", { separation: false });
  const create = (k: any, b: any) =>
    o.write(a, randomUUID(), b, () => o.create(a, k, b));
  const p = create("project", { name: "A" }),
    p2 = create("project", { name: "B" }),
    t = create("task", {
      projectId: p.id,
      name: "Install",
      section: "1",
      target: 10,
      unit: "ea",
      unitHours: 2,
      baselineStart: "2026-12-01",
      baselineEnd: "2026-12-05",
    }),
    part = create("part", {
      partNumber: "P-1",
      description: "Equipment",
      unit: "ea",
    }),
    loc = create("location", { name: "Site" }),
    supplier = create("supplier", { name: "Supplier" }),
    w = create("worker", { name: "Worker", trade: "Electrical" });
  let po = create("po", {
    projectId: p.id,
    supplierId: supplier.id,
    number: "PO-1",
    lines: [{ partId: part.id, quantity: 10, unitCost: 25 }],
  });
  for (const status of ["Submitted", "Approved", "Issued"])
    po = o.write(a, randomUUID(), {}, () =>
      o.transition(a, "po", po.id, { version: po.version, status }),
    );
  const move = (action: string, quantity: number, extra: any = {}) =>
    o.write(a, randomUUID(), {}, () =>
      o.movement(a, {
        action,
        quantity,
        partId: part.id,
        locationId: loc.id,
        projectId: p.id,
        taskId: t.id,
        poId: po.id,
        lineId: po.lines[0].id,
        note: "Accepted test evidence",
        ...extra,
      }),
    );
  const approve = (kind: string, r: any) =>
    o.write(a, randomUUID(), {}, () =>
      v.transition(a, kind, r.id, { version: r.version, status: "Approved" }),
    );
  const command = (name: string, b: any) =>
    o.write(a, randomUUID(), {}, () => v.command(a, name, b));
  return {
    s,
    a,
    o,
    v,
    planning,
    create,
    p,
    p2,
    t,
    part,
    loc,
    supplier,
    w,
    po,
    move,
    approve,
    command,
  };
}
test("project grants isolate reads, writes and exports; viewer snapshots are explicit and stable", () => {
  const f = fixture(),
    pm = f.s.createUser(
      "org",
      "pm@test.invalid",
      "PM",
      "test-only-password",
      "pm",
    ),
    viewer = f.s.createUser(
      "org",
      "gc@test.invalid",
      "GC",
      "test-only-password",
      "viewer",
    );
  assert.equal(f.o.snapshot(pm).data.project.length, 0);
  assert.throws(
    () =>
      f.o.create(pm, "task", {
        projectId: f.p.id,
        name: "Hidden",
        section: "1",
      }),
    /access denied/,
  );
  f.command("grants", { userId: pm.id, projectIds: [f.p.id] });
  assert.equal(f.o.snapshot(pm).data.project.length, 1);
  assert.throws(
    () => reportData(f.o, pm, { projectId: f.p2.id }),
    /access denied/,
  );
  f.command("grants", { userId: viewer.id, projectIds: [f.p.id] });
  assert.equal(f.o.snapshot(viewer).data.project.length, 0);
  f.command("publish", { projectId: f.p.id });
  const before = f.o.snapshot(viewer);
  assert.equal(before.forecast.length, 1);
  assert.equal((before.forecast[0] as any).actual, undefined);
  f.o.edit(f.a, "task", f.t.id, {
    ...f.t,
    name: "Private new name",
    version: f.t.version,
  });
  assert.equal(f.o.snapshot(viewer).data.task[0].name, "Install");
  assert.equal(
    (f.o.snapshot(pm).data as any).po[0].lines[0].unitCost,
    undefined,
  );
  assert.equal(reportData(f.o, pm, {}).tables.Spend, undefined);
});
test("reviewed conversions preserve source quantity and block stale import overwrite", () => {
  const f = fixture(),
    c = f.create("conversion", {
      partId: f.part.id,
      fromUnit: "box",
      toUnit: "ea",
      factor: 5,
      reason: "Five units per manufacturer box",
    });
  f.approve("conversion", c);
  const row = {
    partNumber: "P-1",
    manufacturer: "",
    quantity: 2,
    unit: "box",
    taskId: f.t.id,
    conversionId: c.id,
    needBy: "2026-12-04",
  };
  const preview = previewImport(f.o, f.a, f.p.id, [row]);
  assert.deepEqual(preview[0].errors, []);
  f.o.write(f.a, randomUUID(), {}, () =>
    commitImport(f.o, f.a, {
      projectId: f.p.id,
      rows: [row],
      sourceVersion: "v1",
      reviewTokens: preview.map((p) => p.reviewToken),
    }),
  );
  const req = f.o.all(f.a, "requirement")[0];
  assert.equal(req.quantity, 10);
  assert.equal(req.needBy, "2026-12-04");
  assert.equal(f.o.all(f.a, "import")[0].rows[0].original.quantity, 2);
  assert.throws(
    () =>
      commitImport(f.o, f.a, {
        projectId: f.p.id,
        rows: [row],
        sourceVersion: "v2",
        reviewTokens: preview.map((p) => p.reviewToken),
      }),
    /stale/,
  );
});
test("PO amendment retains line identity, requires current version and cannot reduce below receipts", () => {
  const f = fixture();
  f.move("receive", 6);
  assert.throws(
    () =>
      f.create("poAmendment", {
        projectId: f.p.id,
        poId: f.po.id,
        poVersion: f.po.version,
        reason: "Reduce order",
        freight: 0,
        tax: 0,
        lines: f.po.lines.map((l: any) => ({ ...l, quantity: 5 })),
      }),
    /net received/,
  );
  const amendment = f.create("poAmendment", {
    projectId: f.p.id,
    poId: f.po.id,
    poVersion: f.po.version,
    reason: "Add final equipment",
    freight: 10,
    tax: 2,
    lines: f.po.lines.map((l: any) => ({ ...l, quantity: 12 })),
  });
  f.approve("poAmendment", amendment);
  assert.equal(f.o.ref(f.a, "po", f.po.id).lines[0].id, f.po.lines[0].id);
  assert.equal(f.o.ref(f.a, "po", f.po.id).lines[0].quantity, 12);
  assert.throws(
    () => f.create("poAmendment", { ...amendment, reason: "Stale proposal" }),
    /PO changed/,
  );
});
test("split shipments reject overallocation and duplicate receipt; returns support bounded credits", () => {
  const f = fixture(),
    shipment = f.create("shipment", {
      projectId: f.p.id,
      poId: f.po.id,
      reference: "Delivery 1",
      lines: [{ lineId: f.po.lines[0].id, quantity: 6 }],
    });
  assert.throws(
    () =>
      f.create("shipment", {
        projectId: f.p.id,
        poId: f.po.id,
        reference: "Too many",
        lines: [{ lineId: f.po.lines[0].id, quantity: 5 }],
      }),
    /exceeds/,
  );
  f.move("receive", 6, { shipmentId: shipment.id });
  assert.throws(
    () => f.move("receive", 1, { shipmentId: shipment.id }),
    /shipment quantity/,
  );
  assert.throws(
    () =>
      f.v.transition(f.a, "shipment", shipment.id, {
        version: 1,
        status: "Cancelled",
      }),
    /cannot be cancelled/,
  );
  const returned = f.move("return", 2),
    credit = f.create("credit", {
      projectId: f.p.id,
      poId: f.po.id,
      returnMovementId: returned.id,
      amount: 50,
      reference: "C-1",
      reason: "Returned accepted units",
    });
  f.approve("credit", credit);
  assert.throws(
    () => f.create("credit", { ...credit, amount: 1, reference: "C-2" }),
    /exceeds/,
  );
  assert.throws(
    () => f.move("reverse", 2, { referenceId: returned.id }),
    /credit references/,
  );
});
test("serialized custody prevents bulk consumption, wrong-task issue and receipt reversal", () => {
  const f = fixture(),
    receipt = f.move("receive", 1);
  let asset = f.create("asset", {
    projectId: f.p.id,
    partId: f.part.id,
    receiptId: receipt.id,
    serial: "SN-001",
    warrantyUntil: "2028-01-01",
  });
  assert.throws(() => f.move("reserve", 1), /serialized/);
  assert.throws(
    () => f.create("asset", { ...asset, serial: "SN-002" }),
    /unallocated|More serials/,
  );
  asset = f.command("assetMove", {
    id: asset.id,
    version: asset.version,
    projectId: f.p.id,
    taskId: f.t.id,
    action: "reserve",
    note: "Allocated to work package",
  });
  const other = f.create("task", {
    projectId: f.p.id,
    name: "Other",
    section: "2",
  });
  assert.throws(
    () =>
      f.command("assetMove", {
        id: asset.id,
        version: asset.version,
        projectId: f.p.id,
        taskId: other.id,
        action: "issue",
        note: "Wrong task",
      }),
    /current task/,
  );
  for (const action of ["issue", "install"])
    asset = f.command("assetMove", {
      id: asset.id,
      version: asset.version,
      projectId: f.p.id,
      taskId: f.t.id,
      action,
      note: "Custody evidence",
    });
  assert.equal(asset.status, "Installed");
  assert.equal(f.o.balance(f.a, f.part.id).installed, 1);
  assert.throws(
    () => f.move("reverse", 1, { referenceId: receipt.id }),
    /Serialized/,
  );
  assert.equal(reportData(f.o, f.a, {}).tables.Warranty[0].serial, "SN-001");
});
test("quarantine receipts cannot contribute to readiness until inspected; damaged returns reopen PO", () => {
  const f = fixture();
  f.create("requirement", {
    projectId: f.p.id,
    taskId: f.t.id,
    partId: f.part.id,
    quantity: 10,
  });
  f.move("receive", 10, { condition: "Quarantine" });
  assert.equal(f.o.balance(f.a, f.part.id).available, 0);
  assert.throws(() => f.move("reserve", 1), /Insufficient/);
  f.move("return", 2, { condition: "Damaged" });
  assert.equal(f.o.receiptTotal(f.a, f.po.id, f.po.lines[0].id), 8);
  f.move("inspect", 8, { condition: "Good" });
  assert.equal(f.o.balance(f.a, f.part.id).available, 8);
  assert.throws(() => f.move("inspect", 1), /quarantined/);
});
test("calendar range skips leave and closures; weekly limit participates in conflicts", () => {
  const f = fixture();
  f.create("calendar", {
    workerId: f.w.id,
    workdays: [1, 2, 3, 4, 5],
    shiftStart: 7,
    shiftHours: 9,
    unpaidBreak: 1,
    weeklyLimit: 8,
  });
  f.create("leave", {
    workerId: f.w.id,
    date: "2026-12-02",
    hours: 8,
    reason: "Training",
  });
  const input = {
    projectId: f.p.id,
    taskId: f.t.id,
    workerIds: [f.w.id],
    from: "2026-12-01",
    to: "2026-12-04",
    start: 7,
    hours: 8,
  };
  const preview = f.planning.range(f.a, input);
  assert.equal(preview.count, 3);
  assert.equal(preview.skipped.length, 1);
  assert.throws(
    () =>
      f.o.write(f.a, randomUUID(), {}, () =>
        f.planning.range(f.a, input, true),
      ),
    /Weekly limit/,
  );
  assert.equal(f.o.all(f.a, "assignment").length, 0);
});
test("leveling is explicit, reversible and refuses to overwrite later edits", () => {
  const f = fixture();
  const a = f.create("assignment", {
    projectId: f.p.id,
    taskId: f.t.id,
    workerId: f.w.id,
    date: "2026-12-01",
    start: 7,
    hours: 8,
  });
  f.create("leave", { workerId: f.w.id, date: "2026-12-01", hours: 8 });
  const b = { projectId: f.p.id, from: "2026-12-01", to: "2026-12-04" },
    preview = f.planning.level(f.a, b);
  assert.equal(f.o.ref(f.a, "assignment", a.id).date, "2026-12-01");
  let batch = f.o.write(f.a, randomUUID(), {}, () =>
    f.planning.apply(f.a, { ...b, token: preview.token, selected: [a.id] }),
  );
  assert.equal(f.o.ref(f.a, "assignment", a.id).date, "2026-12-02");
  f.o.write(f.a, randomUUID(), {}, () =>
    f.planning.undo(f.a, { id: batch.id, version: batch.version }),
  );
  assert.equal(f.o.ref(f.a, "assignment", a.id).date, "2026-12-01");
  const p2 = f.planning.level(f.a, b);
  batch = f.o.write(f.a, randomUUID(), {}, () =>
    f.planning.apply(f.a, { ...b, token: p2.token, selected: [a.id] }),
  );
  const current = f.o.ref(f.a, "assignment", a.id);
  f.o.moveAssignment(f.a, a.id, {
    ...current,
    date: "2026-12-03",
    version: current.version,
  });
  assert.throws(
    () => f.planning.undo(f.a, { id: batch.id, version: batch.version }),
    /changed since leveling/,
  );
});
test("scenario waits for material and approved remaining hours; schedule revision preserves original baseline", () => {
  const f = fixture();
  f.create("requirement", {
    projectId: f.p.id,
    taskId: f.t.id,
    partId: f.part.id,
    quantity: 10,
  });
  const b = {
    projectId: f.p.id,
    taskId: f.t.id,
    start: "2026-12-01",
    crew: 4,
    hours: 8,
  };
  assert.equal(f.planning.scenario(f.a, b).finish, null);
  let rf = f.create("reforecast", {
    projectId: f.p.id,
    taskId: f.t.id,
    remainingHours: 64,
    reason: "Reviewed remaining effort",
  });
  f.o.transition(f.a, "reforecast", rf.id, {
    version: rf.version,
    status: "Approved",
  });
  f.move("receive", 10);
  f.move("reserve", 10);
  assert.equal(f.planning.scenario(f.a, b).finish, "2026-12-02");
  const rev = f.create("scheduleRevision", {
    projectId: f.p.id,
    name: "Recovery plan",
    reason: "Explicit date revision",
    dates: [{ taskId: f.t.id, start: "2026-12-03", finish: "2026-12-04" }],
  });
  f.approve("scheduleRevision", rev);
  assert.equal(f.o.ref(f.a, "task", f.t.id).baselineStart, "2026-12-01");
  assert.equal(f.o.ref(f.a, "task", f.t.id).forecastStart, "2026-12-03");
  const baseline = f.create("scheduleRevision", {
    projectId: f.p.id,
    mode: "baseline",
    name: "Approved baseline 2",
    reason: "Approved scope change",
    dates: [{ taskId: f.t.id, start: "2026-12-02", finish: "2026-12-06" }],
  });
  f.approve("scheduleRevision", baseline);
  assert.equal(
    f.o.ref(f.a, "task", f.t.id).originalBaseline.start,
    "2026-12-01",
  );
});
test("linked worker reviews bulk-created time before PM approval; payroll is explicit and validated", () => {
  const f = fixture(),
    worker = f.s.createUser(
      "org",
      "worker@test.invalid",
      "Worker",
      "test-only-password",
      "worker",
      f.w.id,
    );
  f.create("assignment", {
    projectId: f.p.id,
    taskId: f.t.id,
    workerId: f.w.id,
    date: "2026-12-01",
    hours: 8,
  });
  const code = f.create("costCode", {
    projectId: f.p.id,
    code: "LV-1",
    description: "Installation",
    laborType: "field",
  });
  let time = f.create("time", {
    projectId: f.p.id,
    taskId: f.t.id,
    workerId: f.w.id,
    date: "2026-12-01",
    regular: 8,
    costCodeId: code.id,
    workerReviewed: true,
  });
  assert.equal(time.workerReviewed, false);
  time = f.o.transition(f.a, "time", time.id, {
    status: "Submitted",
    version: time.version,
  });
  assert.throws(
    () =>
      f.o.transition(f.a, "time", time.id, {
        status: "Approved",
        version: time.version,
      }),
    /Worker must review/,
  );
  time = f.v.workerReview(worker, time.id, { version: time.version });
  time = f.o.transition(f.a, "time", time.id, {
    status: "Approved",
    version: time.version,
  });
  const query = {
    from: "2026-12-01",
    to: "2026-12-07",
    payroll: "true",
    consent: "confirmed",
  };
  assert.throws(() => reportData(f.o, f.a, query), /permission/);
  f.command("grants", { userId: f.a.id, projectIds: [], payroll: true });
  assert.throws(() => reportData(f.o, f.a, query), /Missing effective/);
  f.command("rate", {
    workerId: f.w.id,
    effective: "2026-01-01",
    rate: 30,
    overtimeMultiplier: 1.5,
    currency: "USD",
  });
  assert.equal(reportData(f.o, f.a, query).tables.Payroll[0].modeledGross, 240);
  assert.throws(
    () => reportData(f.o, f.a, { ...query, consent: "" }),
    /Confirm/,
  );
  assert.equal(
    JSON.stringify(f.o.snapshot(worker)).includes("overtime_multiplier"),
    false,
  );
});
test("timer retries do not start another clock and stop creates reviewed draft only", (ctx) => {
  ctx.mock.timers.enable({
    apis: ["Date"],
    now: Date.parse("2026-12-01T18:00:00Z"),
  });
  const f = fixture();
  const timer = f.command("timer", {
    action: "start",
    workerId: f.w.id,
    projectId: f.p.id,
    taskId: f.t.id,
  });
  assert.throws(
    () =>
      f.command("timer", {
        action: "start",
        workerId: f.w.id,
        projectId: f.p.id,
        taskId: f.t.id,
      }),
    /running timer/,
  );
  const now = Date.now();
  f.s.update(
    f.a,
    "timer",
    timer.id,
    { startedAt: new Date(now - 3600000).toISOString() },
    timer.version,
  );
  const time = f.command("timer", { action: "stop", workerId: f.w.id });
  assert.equal(time.status, "Draft");
  assert.ok(time.regular >= 1 && time.regular < 1.01);
  assert.equal(f.o.forecast(f.a)[0].actual, 0);
});
test("outbox survives failed delivery, reaches dead-letter and retries idempotently", () => {
  const f = fixture();
  processEvents(f.s, 1000);
  f.s.createUser(
    "org",
    "worker@test.invalid",
    "Worker",
    "test-only-password",
    "worker",
    f.w.id,
  );
  f.command("dispatchSetting", {
    enabled: true,
    version: f.o.all(f.a, "settings")[0].version,
  });
  processEvents(f.s, 1000);
  const assignment = f.create("assignment", {
    projectId: f.p.id,
    taskId: f.t.id,
    workerId: f.w.id,
    date: "2026-12-01",
    hours: 8,
  });
  const event = f.s.db
    .prepare("SELECT * FROM outbox WHERE entity=?")
    .get(assignment.id) as any;
  for (let i = 0; i < 5; i++) {
    f.s.db.prepare("UPDATE outbox SET next_at=0 WHERE id=?").run(event.id);
    processEvents(f.s, 100, () => {
      throw new Error("Temporary delivery failure");
    });
  }
  assert.equal(
    (f.s.db.prepare("SELECT state FROM outbox WHERE id=?").get(event.id) as any)
      .state,
    "dead-letter",
  );
  f.command("retryEvent", { id: event.id });
  processEvents(f.s, 100);
  assert.equal(f.o.all(f.a, "notice").length, 1);
  f.command("retryEvent", { id: event.id });
  processEvents(f.s, 100);
  assert.equal(f.o.all(f.a, "notice").length, 1);
});
test("report formats provide readable PDF and workbook with role-safe data", async () => {
  const f = fixture();
  f.move("receive", 6);
  const report = reportData(f.o, f.a, { projectId: f.p.id });
  assert.equal(report.tables.Deliveries[0].remaining, 4);
  assert.equal(report.tables.Spend[0].receivedMaterialValue, 150);
  const pdf = await renderReport(report, "pdf", "Deliveries");
  assert.equal(pdf.body.subarray(0, 5).toString(), "%PDF-");
  writeFileSync("/tmp/fieldops-report-qa.pdf", pdf.body);
  const excel = await renderReport(report, "xlsx");
  assert.equal(excel.body.subarray(0, 2).toString(), "PK");
});

test("serialized damage requires approval and consumes the exact custody balance", () => {
  const f = fixture(),
    receipt = f.move("receive", 1),
    asset = f.create("asset", {
      projectId: f.p.id,
      partId: f.part.id,
      receiptId: receipt.id,
      serial: "QA-DAMAGE",
    });
  const reserved = f.command("assetMove", {
    id: asset.id,
    version: 1,
    projectId: f.p.id,
    taskId: f.t.id,
    action: "reserve",
    note: "Reserved for installation",
  });
  const damage = f.create("adjustment", {
    projectId: f.p.id,
    partId: f.part.id,
    locationId: f.loc.id,
    assetId: asset.id,
    action: "damage",
    quantity: -1,
    reason: "Cracked housing identified in staging",
  });
  assert.equal(f.o.balance(f.a, f.part.id).reserved, 1);
  f.approve("adjustment", damage);
  assert.equal(f.o.balance(f.a, f.part.id).reserved, 0);
  assert.equal(f.o.balance(f.a, f.part.id).onHand, 0);
  assert.equal(f.o.ref(f.a, "asset", asset.id).status, "Damaged");
  assert.throws(
    () =>
      f.command("assetMove", {
        id: asset.id,
        version: reserved.version,
        projectId: f.p.id,
        taskId: f.t.id,
        action: "issue",
        note: "Stale custody action",
      }),
    /changed/,
  );
});
test("task dependencies and shared equipment constrain assignment; cycles are rejected", () => {
  const f = fixture(),
    eq = f.create("equipment", {
      projectId: f.p.id,
      name: "Lift",
      availableFrom: "2026-12-01",
      availableUntil: "2026-12-31",
    }),
    other = f.create("task", {
      projectId: f.p.id,
      name: "Finish work",
      section: "2",
      dependencies: [f.t.id],
      equipmentIds: [eq.id],
    });
  const b = {
    projectId: f.p.id,
    taskId: other.id,
    workerId: f.w.id,
    date: "2026-12-02",
    start: 7,
    hours: 8,
  };
  assert.ok(
    f.o.assignmentConflicts(f.a, b).some((c) => c.includes("dependency")),
  );
  assert.throws(
    () =>
      f.o.edit(f.a, "task", f.t.id, {
        ...f.t,
        dependencies: [other.id],
        version: 1,
      }),
    /cycle/,
  );
});
test("shortage RFQs subtract available stock and open orders without treating readiness as purchasing demand", () => {
  const f = fixture();
  f.create("requirement", {
    projectId: f.p.id,
    taskId: f.t.id,
    partId: f.part.id,
    quantity: 15,
  });
  const result = f.command("shortageRfqs", {
    projectId: f.p.id,
    supplierId: f.supplier.id,
  });
  assert.equal(result.records[0].quantity, 5);
  f.move("receive", 10);
  const again = f.command("shortageRfqs", {
    projectId: f.p.id,
    supplierId: f.supplier.id,
  });
  assert.equal(again.records[0].quantity, 5);
  assert.equal(f.o.readiness(f.a, f.p.id)[0].status, "Blocked");
});
test("production correction changes earned hours only after approval and keeps previous revision", () => {
  const f = fixture();
  let production = f.create("production", {
    projectId: f.p.id,
    taskId: f.t.id,
    date: "2026-12-01",
    quantity: 8,
    unit: "ea",
  });
  production = f.o.transition(f.a, "production", production.id, {
    status: "Approved",
    version: 1,
  });
  const correction = f.create("productionCorrection", {
    projectId: f.p.id,
    productionId: production.id,
    quantity: 5,
    reason: "Three units were not completed",
  });
  assert.equal(f.o.forecast(f.a)[0].earned, 16);
  f.approve("productionCorrection", correction);
  assert.equal(f.o.forecast(f.a)[0].earned, 10);
  assert.equal(
    JSON.parse(
      (
        f.s.db
          .prepare(
            "SELECT body FROM revisions WHERE org=? AND kind='production' AND id=? AND version=2",
          )
          .get(f.a.org, production.id) as any
      ).body,
    ).quantity,
    8,
  );
});
