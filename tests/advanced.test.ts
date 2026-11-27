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

test("material workspace and history preserve scopes, inventories and supplier confidentiality", async () => {
  const { materialWorkspace, materialTimeline } =
    await import("../server/material-views.js");
  const f = fixture();
  f.create("requirement", {
    projectId: f.p.id,
    taskId: f.t.id,
    partId: f.part.id,
    quantity: 8,
    criticality: "critical",
  });
  f.move("receive", 6);
  f.move("reserve", 4);
  const workspace = materialWorkspace(f.o, f.a, f.p.id),
    line = workspace.lines[0];
  assert.equal(line.onHand, 6);
  assert.equal(line.reserved, 4);
  assert.equal(line.available, 2);
  assert.equal(line.ordered, 10);
  assert.equal(line.received, 6);
  assert.equal(line.shortage, 4);
  assert.equal(line.orders[0].forecastFrom, "");
  assert.equal(line.orders[0].unitCost, 25);
  const pm = f.s.createUser(
    "org",
    "materialpm@test.invalid",
    "PM",
    "test-only-password",
    "pm",
  );
  f.command("grants", { userId: pm.id, projectIds: [f.p.id] });
  assert.equal(
    materialWorkspace(f.o, pm, f.p.id).lines[0].orders[0].unitCost,
    undefined,
  );
  const adminHistory = materialTimeline(f.o, f.a, f.p.id, f.part.id),
    pmHistory = materialTimeline(f.o, pm, f.p.id, f.part.id);
  assert.ok(adminHistory.entries.some((e) => e.kind === "po"));
  assert.ok(pmHistory.entries.some((e) => e.kind === "movement"));
  assert.ok(
    !pmHistory.entries.some((e) => ["po", "quote", "import"].includes(e.kind)),
  );
  assert.throws(
    () => materialTimeline(f.o, pm, f.p2.id, f.part.id),
    /access denied/,
  );
});
test("quote comparison requires matched quantities, currency, units and task-scoped approved equivalence", async () => {
  const { compareQuotes } = await import("../server/material-views.js");
  const f = fixture();
  const base = {
    projectId: f.p.id,
    partId: f.part.id,
    supplierId: f.supplier.id,
    quantity: 10,
    unit: "ea",
    unitCost: 20,
    freight: 10,
    tax: 5,
  };
  const matching = f.create("quote", base);
  f.create("quote", { ...base, quantity: 12 });
  f.create("quote", { ...base, currency: "CAD" });
  const alternate = f.create("part", {
    partNumber: "P-ALT",
    description: "Equivalent equipment",
    unit: "ea",
  });
  const eq = f.create("substitution", {
    projectId: f.p.id,
    taskId: f.t.id,
    originalPartId: f.part.id,
    replacementPartId: alternate.id,
    reason: "Manufacturer approved equivalent",
  });
  f.o.write(f.a, randomUUID(), {}, () =>
    f.o.transition(f.a, "substitution", eq.id, {
      version: eq.version,
      status: "Approved",
    }),
  );
  const rfq = f.create("rfq", {
    projectId: f.p.id,
    partId: f.part.id,
    supplierId: f.supplier.id,
    quantity: 10,
  });
  assert.throws(
    () => f.create("quote", { ...base, partId: alternate.id, rfqId: rfq.id }),
    /must match RFQ/,
  );
  f.create("quote", {
    ...base,
    partId: alternate.id,
    rfqId: rfq.id,
    equivalenceId: eq.id,
    unitCost: 15,
  });
  const criteria = {
    projectId: f.p.id,
    partId: f.part.id,
    quantity: 10,
    currency: "USD",
  };
  const exact = compareQuotes(f.o, f.a, criteria);
  assert.equal(exact.rows.filter((q) => q.landedTotal !== null).length, 1);
  assert.equal(exact.rows.find((q) => q.id === matching.id)?.landedTotal, 215);
  assert.equal(exact.rows.filter((q) => q.reasons.length).length, 2);
  const alternatives = compareQuotes(f.o, f.a, { ...criteria, taskId: f.t.id });
  assert.equal(alternatives.rows[0].landedTotal, 165);
  assert.equal(alternatives.rows[0].alternate, true);
  assert.throws(
    () => compareQuotes(f.o, { ...f.a, role: "pm" }, criteria),
    /restricted/,
  );
});
test("procurement lifecycle includes acknowledgements, partial receipts and task allocation without inventing PO linkage", async () => {
  const { procurementStages } = await import("../src/procurement-stages.js");
  const f = fixture();
  f.create("requirement", {
    projectId: f.p.id,
    taskId: f.t.id,
    partId: f.part.id,
    quantity: 10,
  });
  let data = f.o.snapshot(f.a).data,
    board = procurementStages(data, f.p.id);
  assert.equal(board.Requested.length, 1);
  assert.equal(board.Ordered.length, 1);
  f.o.transition(f.a, "po", f.po.id, {
    version: f.po.version,
    status: "Acknowledged",
  });
  board = procurementStages(f.o.snapshot(f.a).data, f.p.id);
  assert.equal(board.Acknowledged.length, 1);
  f.move("receive", 6);
  f.move("reserve", 4);
  f.move("issue", 2);
  f.move("install", 1);
  board = procurementStages(f.o.snapshot(f.a).data, f.p.id);
  assert.equal(board["Partially received"].length, 1);
  assert.equal(board.Allocated[0].quantity, 4);
  assert.equal(board.Installed[0].quantity, 1);
  assert.equal(board.Requested[0].quantity, 6);
  assert.equal(board.Allocated[0].unit, "ea");
  assert.equal(board.Allocated[0].poId, undefined);
});

test("combined field entry is atomic, keeps production separate from time approval, and enforces worker ownership", () => {
  const f = fixture();
  f.create("assignment", {
    projectId: f.p.id,
    taskId: f.t.id,
    workerId: f.w.id,
    date: "2026-12-01",
    hours: 8,
    override: "Reviewed material constraint for field test",
  });
  const worker = f.s.createUser(
    "org",
    "field@test.invalid",
    "Field",
    "test-only-password",
    "worker",
    f.w.id,
  );
  const input = {
    projectId: f.p.id,
    taskId: f.t.id,
    workerId: f.w.id,
    date: "2026-12-01",
    regular: 8,
    quantity: 2,
    unit: "ea",
  };
  const saved = f.o.write(worker, randomUUID(), input, () =>
    f.v.command(worker, "fieldEntry", input),
  );
  assert.equal(saved.time.status, "Draft");
  assert.equal(saved.production.status, "Submitted");
  assert.equal(saved.production.timeId, saved.time.id);
  assert.equal(f.o.forecast(f.a, f.p.id)[0].installed, 0);
  assert.throws(
    () =>
      f.o.edit(worker, "time", saved.time.id, {
        ...saved.time,
        date: "2026-12-02",
      }),
    /Linked production/,
  );
  assert.throws(
    () =>
      f.o.transition(worker, "production", saved.production.id, {
        version: 1,
        status: "Approved",
      }),
    /manager/,
  );
  const before = f.o.all(f.a, "time").length;
  assert.throws(
    () =>
      f.o.write(worker, randomUUID(), {}, () =>
        f.v.command(worker, "fieldEntry", {
          ...input,
          date: "2026-12-02",
          unit: "ft",
        }),
      ),
    /assigned task/,
  );
  assert.equal(f.o.all(f.a, "time").length, before);
  const other = f.create("worker", { name: "Other", trade: "Electrical" });
  assert.throws(
    () =>
      f.o.write(worker, randomUUID(), {}, () =>
        f.v.command(worker, "fieldEntry", { ...input, workerId: other.id }),
      ),
    /access denied|own time/,
  );
});
test("availability requests require project policy, remain private, and affect capacity only after manager approval", () => {
  const f = fixture();
  f.create("assignment", {
    projectId: f.p.id,
    taskId: f.t.id,
    workerId: f.w.id,
    date: "2026-12-01",
    hours: 8,
    override: "Reviewed material constraint for field test",
  });
  const worker = f.s.createUser(
    "org",
    "available@test.invalid",
    "Field",
    "test-only-password",
    "worker",
    f.w.id,
  );
  const request = f.o.create(worker, "availability", {
    projectId: f.p.id,
    workerId: f.w.id,
    date: "2026-12-02",
    hours: 4,
    reason: "Personal availability request",
  });
  assert.equal(f.o.workerCapacity(f.a, f.p, f.w, "2026-12-02"), 8);
  assert.throws(
    () =>
      f.v.transition(worker, "availability", request.id, {
        version: 1,
        status: "Approved",
      }),
    /manager/,
  );
  f.approve("availability", request);
  assert.equal(f.o.workerCapacity(f.a, f.p, f.w, "2026-12-02"), 4);
  assert.equal(
    f.o.all(f.a, "leave")[0].reason,
    "Approved availability request",
  );
  assert.throws(
    () => f.o.ref({ ...f.a, role: "foreman" }, "availability", request.id),
    /restricted/,
  );
  const p = f.o.ref(f.a, "project", f.p.id);
  f.o.edit(f.a, "project", p.id, { ...p, availabilityRequests: false });
  assert.throws(
    () =>
      f.o.create(worker, "availability", {
        projectId: f.p.id,
        workerId: f.w.id,
        date: "2026-12-03",
        hours: 4,
        reason: "Request",
      }),
    /disabled/,
  );
});

test("dated crew membership intersects calendars, preserves paid breaks and captures historical crew attribution", async () => {
  const f = fixture();
  const crew = f.create("crew", {
    name: "Install crew",
    trade: "Electrical",
    shiftStart: 7,
    shiftHours: 9,
    unpaidBreak: 1,
    paidBreak: 0.5,
  });
  const member = f.create("crewMembership", {
    crewId: crew.id,
    workerId: f.w.id,
    from: "2026-12-01",
    to: "2026-12-04",
    role: "Installer",
  });
  assert.equal(f.o.workerCapacity(f.a, f.p, f.w, "2026-12-01"), 8);
  assert.throws(
    () =>
      f.create("crewMembership", {
        crewId: crew.id,
        workerId: f.w.id,
        from: "2026-12-03",
        role: "Installer",
      }),
    /already belongs/,
  );
  f.create("calendar", {
    workerId: f.w.id,
    workdays: [1, 2, 3, 4],
    shiftStart: 8,
    shiftHours: 6,
    unpaidBreak: 0.5,
    paidBreak: 0.25,
  });
  assert.equal(f.o.workerCapacity(f.a, f.p, f.w, "2026-12-01"), 5);
  const assignment = f.create("assignment", {
    crewId: crew.id,
    projectId: f.p.id,
    taskId: f.t.id,
    workerId: f.w.id,
    date: "2026-12-01",
    start: 8,
    hours: 5,
    override: "Reviewed missing material constraints",
  });
  const entry = f.command("fieldEntry", {
    projectId: f.p.id,
    taskId: f.t.id,
    workerId: f.w.id,
    date: "2026-12-01",
    regular: 5,
    start: 8,
    quantity: 1,
    unit: "ea",
  });
  assert.equal(entry.time.crewAtEntry, "Install crew");
  assert.equal(entry.production.crewAtEntry, "Install crew");
  f.command("demobilize", {
    id: member.id,
    version: member.version,
    to: "2026-12-02",
  });
  assert.ok(
    f.o
      .assignmentConflicts(
        f.a,
        { ...assignment, date: "2026-12-03" },
        assignment.id,
      )
      .some((s) => s.includes("effective member")),
  );
  assert.equal(f.o.workerCapacity(f.a, f.p, f.w, "2026-12-03"), 5.5);
  assert.equal(f.o.ref(f.a, "time", entry.time.id).crewAtEntry, "Install crew");
  f.create("assignment", {
    ...assignment,
    date: "2026-12-03",
    override: "Manager reviewed expired crew membership",
  });
  const { workforceData } = await import("../server/workforce.js");
  const report = workforceData(f.o, f.a, {
    project: f.p.id,
    from: "2026-12-01",
    to: "2026-12-07",
  });
  assert.equal(report.TradeSiteHeadcount[0].headcount, 1);
  assert.equal(report.TradeSiteHeadcount[0].trade, "Electrical");
  assert.equal(
    report.CrewCapacity.find(
      (r) => r.date === "2026-12-01" && r.crew === "Install crew",
    )?.plannedHere,
    5,
  );
  assert.ok(report.StaffingBottlenecks.length > 0);
  assert.throws(
    () =>
      workforceData(f.o, f.a, {
        project: f.p.id,
        from: "2026-12-01",
        to: "2028-12-01",
      }),
    /one year/,
  );
});

test("external PO intake reviews units and identity, proposes amendments and refuses stale or duplicate source lines", async () => {
  const { externalPoPreview, externalPoCommit } =
    await import("../server/intake.js");
  const f = fixture();
  const raw = {
    projectId: f.p.id,
    supplierId: f.supplier.id,
    number: "EXT-1",
    source: "external.csv",
    sourceVersion: "1",
    currency: "USD",
    freight: 0,
    tax: 0,
    rows: [
      {
        externalLineId: "line-a",
        partNumber: "P-1",
        manufacturer: "",
        quantity: "4",
        unit: "ea",
        unitCost: "30",
      },
    ],
  };
  const preview = externalPoPreview(f.o, f.a, raw);
  assert.equal(preview.action, "Create draft");
  const commit = (b: any) =>
    f.o.write(f.a, randomUUID(), b, () => externalPoCommit(f.o, f.a, b));
  const result = commit({ ...raw, token: preview.token });
  assert.equal(result.record.lines[0].externalLineId, "line-a");
  assert.throws(
    () => commit({ ...raw, token: preview.token }),
    /preview changed/,
  );
  let po = result.record;
  for (const status of ["Submitted", "Approved", "Issued"])
    po = f.o.transition(f.a, "po", po.id, { version: po.version, status });
  const revision = {
      ...raw,
      sourceVersion: "2",
      rows: [{ ...raw.rows[0], quantity: "6" }],
    },
    review = externalPoPreview(f.o, f.a, revision);
  const amended = commit({ ...revision, token: review.token });
  assert.equal(amended.action, "Propose amendment");
  assert.equal(amended.record.status, "Proposed");
  assert.equal(f.o.ref(f.a, "po", po.id).lines[0].quantity, 4);
  f.approve("poAmendment", amended.record);
  assert.equal(f.o.ref(f.a, "po", po.id).lines[0].quantity, 6);
  assert.equal(f.o.ref(f.a, "po", po.id).lines[0].id, po.lines[0].id);
  assert.ok(
    externalPoPreview(f.o, f.a, {
      ...raw,
      rows: [raw.rows[0], raw.rows[0]],
    }).lines[1].errors.includes("Duplicate external line ID"),
  );
  assert.ok(
    externalPoPreview(f.o, f.a, {
      ...raw,
      rows: [{ ...raw.rows[0], unit: "box" }],
    }).lines[0].errors.some((e) => e.includes("Unit")),
  );
});
test("estimate adapter retains explicit units, reviewed whole-project budgets and task allocations without double-import or schedule edits", async () => {
  const { adaptEstimate, estimatePreview, estimateCommit } =
    await import("../server/intake.js");
  const f = fixture();
  const adapted = adaptEstimate({
    bomSnapshot: { id: "bid-estimate", pmHours: "3" },
    revisionNumber: 2,
    lineItemsSnapshot: [
      {
        id: "source-1",
        partNumber: "P-1",
        manufacturer: "",
        description: "Equipment",
        quantity: 10,
        laborHours: "2.5",
      },
      {
        id: "indirect",
        description: "Shipping",
        quantity: 1,
        laborHours: "5",
        belowTheLine: true,
      },
    ],
  });
  assert.equal(adapted.fieldBudget, 25);
  assert.equal(adapted.pmBudget, 3);
  assert.equal(adapted.lines[0].unit, "");
  assert.equal(adapted.lines[1].excluded, true);
  const raw = {
    projectId: f.p.id,
    estimateId: adapted.estimateId,
    sourceVersion: adapted.sourceVersion,
    sourceHash: adapted.sourceHash,
    source: "Bidlark revision JSON",
    fieldBudget: 25,
    pmBudget: 3,
    rows: [{ ...adapted.lines[0], unit: "ea", taskId: f.t.id }],
    allocations: [{ taskId: f.t.id, hours: 20 }],
  };
  const preview = estimatePreview(f.o, f.a, raw);
  assert.equal(preview.errors.length, 0);
  assert.equal(preview.rows[0].errors.length, 0);
  const result = f.o.write(f.a, randomUUID(), raw, () =>
    estimateCommit(f.o, f.a, { ...raw, token: preview.token }),
  );
  assert.equal(result.materials, 1);
  assert.equal(f.o.ref(f.a, "project", f.p.id).fieldBudget, 25);
  assert.equal(f.o.ref(f.a, "task", f.t.id).allocatedHours, 20);
  assert.equal(f.o.ref(f.a, "task", f.t.id).baselineStart, "2026-12-01");
  assert.ok(
    estimatePreview(f.o, f.a, raw).errors.some((e) =>
      e.includes("already imported"),
    ),
  );
  const revision = {
    ...raw,
    sourceVersion: "3",
    fieldBudget: 15,
    allocations: [],
  };
  assert.ok(
    estimatePreview(f.o, f.a, revision).errors.some((e) =>
      e.includes("exceed"),
    ),
  );
  const next = { ...raw, sourceVersion: "3", fieldBudget: 30 },
    nextReview = estimatePreview(f.o, f.a, next),
    task = f.o.ref(f.a, "task", f.t.id);
  f.o.edit(f.a, "task", task.id, { ...task, name: "Changed task" });
  assert.throws(
    () =>
      f.o.write(f.a, randomUUID(), next, () =>
        estimateCommit(f.o, f.a, { ...next, token: nextReview.token }),
      ),
    /review changed/,
  );
  assert.equal(f.o.ref(f.a, "project", f.p.id).fieldBudget, 25);
});

test("customer sell prices and auditable rates require separate grants and never enter operational snapshots", async () => {
  const { financialView, savePrice } = await import("../server/financial.js");
  const f = fixture();
  assert.throws(() => savePrice(f.o, f.a, {}), /Explicit/);
  const finance = f.s.createUser(
    "org",
    "finance@test.invalid",
    "Finance",
    "test-only-password",
    "finance",
  );
  f.create("assignment", {
    projectId: f.p.id,
    taskId: f.t.id,
    workerId: f.w.id,
    date: "2026-12-01",
    hours: 8,
    override: "Reviewed material availability test",
  });
  f.command("grants", {
    userId: finance.id,
    projectIds: [f.p.id],
    commercial: true,
    payroll: true,
  });
  const price = {
    projectId: f.p.id,
    description: "Customer equipment allowance",
    quantity: 10,
    unit: "ea",
    currency: "USD",
    method: "markup",
    unitSell: 0,
    costBasis: 75,
    markupPercent: 20,
    reason: "Approved commercial pricing basis",
  };
  const saved = f.o.write(finance, randomUUID(), price, () =>
    savePrice(f.o, finance, price),
  );
  assert.equal(saved.unitSell, 90);
  assert.equal(saved.total, 900);
  const approved = f.o.write(finance, randomUUID(), {}, () =>
    savePrice(f.o, finance, { id: saved.id, version: 1 }, true),
  );
  assert.equal(approved.status, "Approved");
  const revised = f.o.write(finance, randomUUID(), {}, () =>
    savePrice(f.o, finance, {
      ...price,
      id: saved.id,
      version: 2,
      markupPercent: 25,
    }),
  );
  assert.equal(revised.status, "Draft");
  assert.equal(financialView(f.o, finance).priceHistory.length, 3);
  assert.throws(
    () => savePrice(f.o, finance, { ...price, id: saved.id, version: 1 }),
    /changed/,
  );
  assert.equal(financialView(f.o, f.a).prices.length, 0);
  assert.ok(
    !JSON.stringify(f.o.snapshot(f.a)).includes("Customer equipment allowance"),
  );
  for (const rate of [32, 35])
    f.o.write(finance, randomUUID(), {}, () =>
      f.v.rates(finance, {
        workerId: f.w.id,
        effective: "2026-12-01",
        rate,
        overtimeMultiplier: 1.5,
        currency: "USD",
        reason: "Reviewed labor rate",
      }),
    );
  const history = financialView(f.o, finance).rateHistory;
  assert.equal(history.length, 2);
  assert.equal(history[0].before.rate, 32);
  assert.equal(history[0].after.rate, 35);
  assert.equal(financialView(f.o, f.a).rateHistory.length, 0);
  assert.throws(
    () => savePrice(f.o, finance, { ...price, projectId: f.p2.id }),
    /access denied/,
  );
  f.command("grants", {
    userId: finance.id,
    projectIds: [f.p.id],
    payroll: false,
    commercial: false,
  });
  assert.equal(financialView(f.o, finance).priceHistory.length, 0);
});

test("offline field sync refuses stale work packages and keeps retry receipts idempotent", () => {
  const f = fixture(),
    assignment = f.create("assignment", {
      projectId: f.p.id,
      taskId: f.t.id,
      workerId: f.w.id,
      date: "2026-12-01",
      hours: 8,
      override: "Reviewed material constraint for offline test",
    }),
    worker = f.s.createUser(
      "org",
      "offline@test.invalid",
      "Field",
      "test-only-password",
      "worker",
      f.w.id,
    );
  const draft = {
    mode: "fieldEntry",
    context: {
      assignmentId: assignment.id,
      assignmentVersion: assignment.version,
      taskVersion: f.t.version,
    },
    payload: {
      projectId: f.p.id,
      taskId: f.t.id,
      workerId: f.w.id,
      date: "2026-12-01",
      regular: 8,
      quantity: 2,
      unit: "ea",
    },
  };
  const current = f.o.edit(f.a, "task", f.t.id, {
    ...f.t,
    instructions: "Revised field instructions",
  });
  assert.throws(
    () =>
      f.o.write(worker, randomUUID(), draft, () =>
        f.v.command(worker, "fieldSync", draft),
      ),
    /package changed/,
  );
  assert.equal(f.o.all(f.a, "time").length, 0);
  draft.context.taskVersion = current.version;
  const key = randomUUID();
  const saved = f.o.write(worker, key, draft, () =>
    f.v.command(worker, "fieldSync", draft),
  );
  const again = f.o.write(worker, key, draft, () =>
    f.v.command(worker, "fieldSync", draft),
  );
  assert.equal(saved.time.id, again.time.id);
  assert.equal(f.o.all(f.a, "time").length, 1);
  assert.throws(
    () =>
      f.o.write(worker, randomUUID(), {}, () =>
        f.v.command(worker, "fieldSync", {
          ...draft,
          payload: { ...draft.payload, date: "2026-12-02" },
        }),
      ),
    /must match/,
  );
});

test("foremen receive scoped orders without price access; receipt value survives amendments and returns", () => {
  const f = fixture(),
    foreman = f.s.createUser(
      "org",
      "receiving@test.invalid",
      "Receiving",
      "test-only-password",
      "foreman",
    );
  f.command("grants", { userId: foreman.id, projectIds: [f.p.id] });
  const input = {
    action: "receive",
    quantity: 6,
    partId: f.part.id,
    locationId: f.loc.id,
    projectId: f.p.id,
    poId: f.po.id,
    lineId: f.po.lines[0].id,
    note: "Packing slip verified",
  };
  const receipt = f.o.write(foreman, randomUUID(), input, () =>
    f.o.movement(foreman, input),
  );
  assert.equal(receipt.poVersion, f.po.version);
  assert.equal(
    (f.o.snapshot(foreman).data as any).po[0].lines[0].unitCost,
    undefined,
  );
  const amendment = f.create("poAmendment", {
    projectId: f.p.id,
    poId: f.po.id,
    poVersion: f.po.version,
    reason: "Approved price change on remaining order",
    freight: 0,
    tax: 0,
    lines: f.po.lines.map((l: any) => ({ ...l, unitCost: 50, taskId: f.t.id })),
  });
  f.approve("poAmendment", amendment);
  let report = reportData(f.o, f.a, { projectId: f.p.id });
  assert.equal(report.tables.Spend[0].receivedMaterialValue, 150);
  assert.equal(report.tables.Spend[0].openMaterialCommitment, 200);
  f.move("receive", 4);
  report = reportData(f.o, f.a, { projectId: f.p.id });
  assert.equal(report.tables.Spend[0].receivedMaterialValue, 350);
  const returned = f.move("return", 2);
  assert.equal(
    reportData(f.o, f.a, { projectId: f.p.id }).tables.Spend[0]
      .receivedMaterialValue,
    280,
  );
  f.move("reverse", 2, { referenceId: returned.id });
  assert.equal(
    reportData(f.o, f.a, { projectId: f.p.id }).tables.Spend[0]
      .receivedMaterialValue,
    350,
  );
  assert.equal(
    reportData(f.o, f.a, { projectId: f.p.id, section: "1" }).tables.Spend
      .length,
    1,
  );
  assert.equal(
    reportData(f.o, f.a, { projectId: f.p.id, section: "unallocated" }).tables
      .Spend.length,
    0,
  );
  f.command("grants", { userId: foreman.id, projectIds: [] });
  assert.throws(() => f.o.movement(foreman, input), /access denied/);
  f.s.close();
});

test("typed material readiness and progress events share the transaction and suppress replay", () => {
  const f = fixture();
  f.create("requirement", {
    projectId: f.p.id,
    taskId: f.t.id,
    partId: f.part.id,
    quantity: 10,
  });
  f.move("receive", 10);
  const key = randomUUID(),
    payload = {
      action: "reserve",
      quantity: 10,
      partId: f.part.id,
      locationId: f.loc.id,
      projectId: f.p.id,
      taskId: f.t.id,
      note: "Reserve all required stock",
    };
  const reserve = () =>
    f.o.write(f.a, key, payload, () => f.o.movement(f.a, payload));
  reserve();
  const events = () =>
    f.s.db.prepare("SELECT * FROM outbox WHERE org=?").all(f.a.org) as any[];
  assert.equal(
    events().filter((e) => e.event_type === "MaterialReceiptRecorded").length,
    1,
  );
  assert.equal(
    events().filter((e) => e.event_type === "TaskMaterialsBecameReady").length,
    1,
  );
  const count = events().length;
  reserve();
  assert.equal(events().length, count);
  assert.throws(
    () =>
      f.o.write(f.a, randomUUID(), {}, () => {
        f.s.add(f.a, "task", { ...f.t, id: undefined, name: "Must roll back" });
        throw Error("Rollback");
      }),
    /Rollback/,
  );
  assert.equal(events().length, count);
  f.move("release", 1);
  const changed = events()
    .filter((e) => e.event_type === "TaskMaterialReadinessChanged")
    .at(-1);
  assert.equal(JSON.parse(changed.payload).materialStatus, "Partial");
  assert.ok(
    !events()
      .filter((e) =>
        ["MaterialReceiptRecorded", "ProjectProgressChanged"].includes(
          e.event_type,
        ),
      )
      .some((e) => /unitCost|payroll|unitSell/.test(e.payload)),
  );
  f.s.close();
});
