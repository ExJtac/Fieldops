import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Store, type Actor } from "../server/store.js";
import { Operations, capacity } from "../server/domain.js";
import { previewImport, commitImport } from "../server/imports.js";
import { Advanced } from "../server/advanced.js";
import { seed } from "../server/seed.js";
function fixture() {
  const store = new Store(":memory:");
  store.db.prepare("INSERT INTO organizations VALUES(?,?)").run("org", "Test");
  const a: Actor = { id: "admin", org: "org", name: "Admin", role: "admin" },
    o = new Operations(store);
  const p = o.create(a, "project", { name: "A" }),
    p2 = o.create(a, "project", { name: "B" }),
    t = o.create(a, "task", {
      projectId: p.id,
      name: "Task A",
      section: "S1",
      target: 100,
      unit: "ea",
      unitHours: 2,
    }),
    t2 = o.create(a, "task", {
      projectId: p2.id,
      name: "Task B",
      section: "S1",
      target: 100,
    }),
    part = o.create(a, "part", {
      partNumber: "ABC",
      manufacturer: "Maker",
      description: "Test part",
      unit: "ea",
      aliases: ["ABC-1", "ABC-2"],
    }),
    loc = o.create(a, "location", { name: "Warehouse" }),
    supplier = o.create(a, "supplier", { name: "Vendor" }),
    w = o.create(a, "worker", {
      name: "Worker",
      trade: "Electrical",
      dailyHours: 8,
    });
  let po = o.create(a, "po", {
    projectId: p.id,
    supplierId: supplier.id,
    number: "PO-1",
    lines: [
      { partId: part.id, quantity: 100, unitCost: 2, leadMin: 5, leadMax: 10 },
    ],
  });
  for (const status of ["Submitted", "Approved", "Issued"])
    po = o.transition(a, "po", po.id, { status, version: po.version });
  const move = (action: string, quantity: number, extra: any = {}) =>
    o.write(a, randomUUID(), { action, quantity, extra }, () =>
      o.movement(a, {
        action,
        quantity,
        partId: part.id,
        locationId: loc.id,
        projectId: p.id,
        taskId: t.id,
        poId: po.id,
        lineId: po.lines[0].id,
        note: "Test movement",
        ...extra,
      }),
    );
  return { store, a, o, p, p2, t, t2, part, loc, supplier, w, po, move };
}
test("partial receipt: 60 / 100, remaining 40", () => {
  const f = fixture();
  f.move("receive", 60);
  assert.equal(f.o.receiptTotal(f.a, f.po.id, f.po.lines[0].id), 60);
  assert.equal(f.o.balance(f.a, f.part.id).available, 60);
  assert.throws(() => f.move("receive", 41), /exceeds/);
  assert.equal(f.o.balance(f.a, f.part.id).onHand, 60);
});
test("reserve 50 of 60; another project cannot reserve 20", () => {
  const f = fixture();
  f.move("receive", 60);
  f.move("reserve", 50);
  assert.throws(
    () => f.move("reserve", 20, { projectId: f.p2.id, taskId: f.t2.id }),
    /Insufficient/,
  );
  assert.equal(f.o.balance(f.a, f.part.id).available, 10);
});
test("issued stock is not available and cannot be double issued", () => {
  const f = fixture();
  f.move("receive", 60);
  f.move("reserve", 50);
  f.move("issue", 40);
  assert.deepEqual(f.o.balance(f.a, f.part.id), {
    onHand: 20,
    reserved: 10,
    available: 10,
    issued: 40,
    installed: 0,
  });
  assert.throws(() => f.move("issue", 20), /reserved/);
  f.move("install", 30);
  assert.equal(f.o.balance(f.a, f.part.id).installed, 30);
  assert.throws(() => f.move("install", 20), /exceeds/);
});
test("returns require available stock and reopen unreceived quantity", () => {
  const f = fixture();
  f.move("receive", 60);
  f.move("reserve", 50);
  assert.throws(() => f.move("return", 20), /Cannot return/);
  f.move("return", 10);
  assert.equal(f.o.receiptTotal(f.a, f.po.id, f.po.lines[0].id), 50);
  f.move("receive", 50);
  assert.equal(f.o.receiptTotal(f.a, f.po.id, f.po.lines[0].id), 100);
});
test("stock transfer conserves workspace totals", () => {
  const f = fixture();
  f.move("receive", 60);
  const loc2 = f.o.create(f.a, "location", { name: "Site" });
  f.move("transfer", 20, { toLocationId: loc2.id });
  assert.equal(f.o.balance(f.a, f.part.id).onHand, 60);
  assert.equal(f.o.balance(f.a, f.part.id, loc2.id).available, 20);
});
test("reversals reject dependency violations and preserve the original", () => {
  const f = fixture();
  const receipt = f.move("receive", 60);
  const reservation = f.move("reserve", 50);
  assert.throws(
    () => f.move("reverse", 60, { referenceId: receipt.id }),
    /dependent/,
  );
  f.move("reverse", 50, { referenceId: reservation.id });
  f.move("reverse", 60, { referenceId: receipt.id });
  assert.equal(f.o.balance(f.a, f.part.id).onHand, 0);
  assert.throws(
    () => f.move("reverse", 60, { referenceId: receipt.id }),
    /Already/,
  );
  assert.throws(
    () =>
      f.store.db.prepare("DELETE FROM records WHERE kind=?").run("movement"),
    /append-only/,
  );
});
test("idempotency retries never duplicate a receipt", () => {
  const f = fixture();
  const key = randomUUID(),
    payload = { action: "receive", quantity: 60 };
  const fn = () =>
    f.o.movement(f.a, {
      ...payload,
      partId: f.part.id,
      locationId: f.loc.id,
      projectId: f.p.id,
      poId: f.po.id,
      lineId: f.po.lines[0].id,
      note: "Retry test",
    });
  const a = f.o.write(f.a, key, payload, fn),
    b = f.o.write(f.a, key, payload, fn);
  assert.equal(a.id, b.id);
  assert.equal(f.o.balance(f.a, f.part.id).onHand, 60);
  assert.throws(
    () => f.o.write(f.a, key, { quantity: 40 }, fn),
    /different request/,
  );
});
test("cross-tenant references cannot be read or written", () => {
  const f = fixture();
  f.store.db
    .prepare("INSERT INTO organizations VALUES(?,?)")
    .run("other", "Other");
  const other = { ...f.a, org: "other" };
  assert.throws(() => f.o.ref(other, "project", f.p.id), /not found/);
  assert.throws(
    () =>
      f.o.create(other, "task", {
        projectId: f.p.id,
        name: "Illegal",
        section: "S1",
      }),
    /not found/,
  );
  assert.equal(f.o.snapshot(other).data.project.length, 0);
});
test("duplicate aliases and mismatched units remain explicit review errors", () => {
  const f = fixture(),
    row = {
      manufacturer: "Maker",
      partNumber: "ABC-1",
      quantity: 33,
      unit: "ea",
      taskId: f.t.id,
      source: "original quote",
    };
  const preview = previewImport(f.o, f.a, f.p.id, [
    row,
    { ...row, partNumber: "ABC-2" },
    { ...row, partNumber: "ABC", unit: "box" },
  ]);
  assert.equal(preview[0].errors.length, 0);
  assert.match(preview[1].errors.join(), /Duplicate/);
  assert.match(preview[2].errors.join(), /Unit mismatch/);
  assert.deepEqual(preview[0].original, row);
  assert.throws(
    () =>
      commitImport(f.o, f.a, {
        projectId: f.p.id,
        rows: [row, { ...row, unit: "box" }],
        sourceVersion: "v1",
        reviewTokens: previewImport(f.o, f.a, f.p.id, [row]).map(
          (p) => p.reviewToken,
        ),
      }),
    /review errors/,
  );
});
test("BOM revisions replace required quantity instead of double counting", () => {
  const f = fixture(),
    row = {
      manufacturer: "Maker",
      partNumber: "ABC",
      quantity: 33,
      unit: "ea",
      taskId: f.t.id,
    };
  commitImport(f.o, f.a, {
    projectId: f.p.id,
    rows: [row],
    sourceVersion: "v1",
    reviewTokens: previewImport(f.o, f.a, f.p.id, [row]).map(
      (p) => p.reviewToken,
    ),
  });
  commitImport(f.o, f.a, {
    projectId: f.p.id,
    rows: [{ ...row, quantity: 40 }],
    sourceVersion: "v2",
    reviewTokens: previewImport(f.o, f.a, f.p.id, [
      { ...row, quantity: 40 },
    ]).map((p) => p.reviewToken),
  });
  assert.equal(f.o.all(f.a, "requirement").length, 1);
  assert.equal(f.o.all(f.a, "requirement")[0].quantity, 40);
  assert.equal(f.o.all(f.a, "import").length, 2);
});
test("shortage and holds do not mutate approved baseline", () => {
  const f = fixture();
  const t = f.o.create(f.a, "task", {
    projectId: f.p.id,
    name: "Baseline",
    section: "S1",
    baselineStart: "2026-12-01",
    baselineEnd: "2026-12-05",
  });
  f.o.create(f.a, "requirement", {
    projectId: f.p.id,
    taskId: t.id,
    partId: f.part.id,
    quantity: 100,
  });
  const hold = f.o.create(f.a, "hold", {
    projectId: f.p.id,
    taskId: t.id,
    reason: "Waiting for tray",
    proposedStart: "2026-12-20",
  });
  f.o.transition(f.a, "hold", hold.id, {
    status: "Approved",
    version: hold.version,
  });
  assert.equal(
    f.o.readiness(f.a).find((r) => r.taskId === t.id)?.status,
    "Blocked",
  );
  assert.equal(f.o.ref(f.a, "task", t.id).baselineStart, "2026-12-01");
  assert.throws(
    () =>
      f.o.edit(f.a, "task", t.id, {
        version: t.version,
        baselineStart: "2026-12-20",
        baselineEnd: "2026-12-25",
      }),
    /immutable/,
  );
});
test("unacknowledged ARO quote has no fabricated arrival date", () => {
  const f = fixture();
  const q = f.o.create(f.a, "quote", {
    projectId: f.p.id,
    partId: f.part.id,
    supplierId: f.supplier.id,
    quantity: 100,
    unit: "ea",
    unitCost: 2,
    leadMin: 95,
    leadMax: 95,
  });
  assert.equal(q.ackDate, "");
  assert.equal(q.confirmedETA, undefined);
});
test("cross-project overlapping assignment fails unless justified", () => {
  const f = fixture(),
    b = {
      projectId: f.p.id,
      taskId: f.t.id,
      workerId: f.w.id,
      date: "2026-12-01",
      start: 7,
      hours: 8,
    };
  f.o.create(f.a, "assignment", b);
  assert.throws(
    () =>
      f.o.create(f.a, "assignment", {
        ...b,
        projectId: f.p2.id,
        taskId: f.t2.id,
      }),
    /overlapping/,
  );
  const override = f.o.create(f.a, "assignment", {
    ...b,
    projectId: f.p2.id,
    taskId: f.t2.id,
    override: "Manager approved shared standby assignment",
  });
  assert.ok(override.conflicts.length);
});
test("leave, holidays and certification expiry restrict capacity", () => {
  const f = fixture();
  f.o.create(f.a, "leave", { workerId: f.w.id, date: "2026-12-01", hours: 8 });
  assert.throws(
    () =>
      f.o.create(f.a, "assignment", {
        projectId: f.p.id,
        taskId: f.t.id,
        workerId: f.w.id,
        date: "2026-12-01",
        hours: 8,
      }),
    /0 available/,
  );
  const p = { ...f.p, holidays: ["2026-12-25"] };
  assert.equal(capacity(p, f.w, "2026-12-25", []), 0);
  const t = f.o.create(f.a, "task", {
    projectId: f.p.id,
    name: "Certified task",
    section: "S1",
    requiredSkill: "License",
  });
  assert.throws(
    () =>
      f.o.create(f.a, "assignment", {
        projectId: f.p.id,
        taskId: t.id,
        workerId: f.w.id,
        date: "2026-12-02",
        hours: 8,
      }),
    /certification/,
  );
});
test("calendar-date capacity is stable across DST transitions", () => {
  const f = fixture(),
    p = { ...f.p, workdays: [0, 1, 2, 3, 4, 5, 6] };
  assert.equal(capacity(p, f.w, "2026-03-08", []), 8);
  assert.equal(capacity(p, f.w, "2026-11-01", []), 8);
  assert.throws(() =>
    f.o.create(f.a, "leave", {
      workerId: f.w.id,
      date: "2026-02-30",
      hours: 8,
    }),
  );
});
test("only approved time changes actual hours; corrections remain audited", () => {
  const f = fixture();
  let t = f.o.create(f.a, "time", {
    projectId: f.p.id,
    taskId: f.t.id,
    workerId: f.w.id,
    date: "2026-12-01",
    regular: 8,
  });
  assert.equal(f.o.forecast(f.a)[0].actual, 0);
  t = f.o.transition(f.a, "time", t.id, {
    status: "Submitted",
    version: t.version,
  });
  assert.equal(f.o.forecast(f.a)[0].actual, 0);
  t = f.o.transition(f.a, "time", t.id, {
    status: "Approved",
    version: t.version,
  });
  assert.equal(f.o.forecast(f.a)[0].actual, 8);
  t = f.o.transition(f.a, "time", t.id, {
    status: "Locked",
    version: t.version,
  });
  assert.throws(
    () => f.o.edit(f.a, "time", t.id, { version: t.version, regular: 6 }),
    /correction/,
  );
  t = f.o.transition(f.a, "time", t.id, {
    status: "Correction requested",
    version: t.version,
    reason: "Correct quantity",
  });
  t = f.o.transition(f.a, "time", t.id, {
    status: "Rejected",
    version: t.version,
    reason: "Correction approved",
  });
  assert.equal(f.o.forecast(f.a)[0].actual, 0);
  assert.ok(f.store.auditList(f.a.org).length > 0);
});
test("duplicate and overlapping time windows are blocked", () => {
  const f = fixture(),
    b = {
      projectId: f.p.id,
      taskId: f.t.id,
      workerId: f.w.id,
      date: "2026-12-01",
      regular: 8,
      start: 7,
    };
  f.o.create(f.a, "time", b);
  assert.throws(
    () => f.o.create(f.a, "time", { ...b, start: 10, regular: 2 }),
    /Overlapping/,
  );
  assert.throws(() => f.o.create(f.a, "time", { ...b, start: 23, regular: 8 }));
});
test("33 installed units affect only the linked task, with approved denominator", () => {
  const f = fixture();
  const t = f.o.create(f.a, "task", {
    projectId: f.p.id,
    name: "33 CAT6A drops",
    section: "S1",
    unit: "ea",
    target: 33,
    unitHours: 2,
  });
  let prod = f.o.create(f.a, "production", {
    projectId: f.p.id,
    taskId: t.id,
    date: "2026-12-01",
    quantity: 33,
    unit: "ea",
  });
  assert.equal(f.o.forecast(f.a).find((x) => x.taskId === t.id)?.installed, 0);
  f.o.transition(f.a, "production", prod.id, {
    version: prod.version,
    status: "Approved",
  });
  assert.equal(f.o.forecast(f.a).find((x) => x.taskId === t.id)?.progress, 100);
  assert.equal(f.o.forecast(f.a).find((x) => x.taskId === f.t.id)?.progress, 0);
  assert.equal(f.o.forecast(f.a).find((x) => x.taskId === t.id)?.earned, 66);
});
test("role redaction: PM and foreman cannot see vendor unit costs; GC cannot see workers", () => {
  const f = fixture();
  f.store.db
    .prepare("INSERT INTO project_access VALUES(?,?,?)")
    .run(f.a.org, f.a.id, f.p.id);
  new Advanced(f.o).publish(f.a, { projectId: f.p.id });
  for (const role of ["pm", "foreman"] as const) {
    const snap: any = f.o.snapshot({ ...f.a, role });
    assert.equal(snap.data.po[0].lines[0].unitCost, undefined);
    assert.equal(snap.data.po[0].freight, undefined);
    assert.equal(snap.data.quote.length, 0);
  }
  const gc: any = f.o.snapshot({ ...f.a, role: "viewer" });
  assert.equal(gc.data.worker, undefined);
  assert.equal(gc.data.po, undefined);
  assert.equal(gc.forecast[0].actual, undefined);
  assert.throws(
    () =>
      f.o.create({ ...f.a, role: "viewer" }, "part", {
        partNumber: "X",
        description: "X",
        unit: "ea",
      }),
    /role/,
  );
});
test("worker cannot submit another worker’s time", () => {
  const f = fixture();
  f.store.db
    .prepare("INSERT INTO project_access VALUES(?,?,?)")
    .run(f.a.org, f.a.id, f.p.id);
  assert.throws(
    () =>
      f.o.create({ ...f.a, role: "worker", workerId: "different" }, "time", {
        projectId: f.p.id,
        taskId: f.t.id,
        workerId: f.w.id,
        date: "2026-12-01",
        regular: 8,
      }),
    /own time|Worker record access denied/,
  );
});
test("segregation of duties rejects self approval", () => {
  const f = fixture();
  f.store.add(f.a, "settings", { separation: true });
  const t = f.o.create(f.a, "time", {
    projectId: f.p.id,
    taskId: f.t.id,
    workerId: f.w.id,
    date: "2026-12-01",
    regular: 8,
  });
  const submitted = f.o.transition(f.a, "time", t.id, {
    version: t.version,
    status: "Submitted",
  });
  assert.throws(
    () =>
      f.o.transition(f.a, "time", t.id, {
        version: submitted.version,
        status: "Approved",
      }),
    /different authorized/,
  );
});
test("stale edits conflict and issued PO quantity cannot be changed silently", () => {
  const f = fixture();
  const updated = f.o.edit(f.a, "worker", f.w.id, {
    version: f.w.version,
    name: "Changed",
  });
  assert.equal(updated.version, 2);
  assert.throws(
    () => f.o.edit(f.a, "worker", f.w.id, { version: 1, name: "Stale" }),
    /changed/,
  );
  assert.throws(
    () =>
      f.o.edit(f.a, "po", f.po.id, {
        version: f.po.version,
        lines: [{ partId: f.part.id, quantity: 1, unitCost: 2 }],
      }),
    /Only draft/,
  );
});
test("demo fixture uses four synthetic people and no allocated section budget", () => {
  const store = new Store(":memory:");
  store.db.prepare("INSERT INTO organizations VALUES(?,?)").run("demo", "Demo");
  const a: Actor = { id: "admin", org: "demo", name: "Admin", role: "admin" },
    o = new Operations(store);
  store.tx(() => seed(o, a));
  assert.equal(o.all(a, "worker").length, 4);
  assert.equal(o.all(a, "project")[0].fieldBudget, 1793.95);
  assert.equal(
    o.all(a, "assignment").reduce((s, r) => s + r.hours, 0),
    32,
  );
  assert.equal(o.all(a, "time")[0].status, "Submitted");
});

test("return reversal cannot overreceive after a replacement delivery", () => {
  const f = fixture();
  f.move("receive", 100);
  const returned = f.move("return", 20);
  f.move("receive", 20);
  assert.throws(
    () => f.move("reverse", 20, { referenceId: returned.id }),
    /exceed PO quantity/,
  );
  assert.equal(f.o.receiptTotal(f.a, f.po.id, f.po.lines[0].id), 100);
});

test("failed transaction rolls back all records, movements and audit events", () => {
  const f = fixture();
  const before = f.store.auditList(f.a.org).length;
  assert.throws(
    () =>
      f.o.write(f.a, randomUUID(), { operation: "atomic test" }, () => {
        f.o.create(f.a, "project", { name: "Must roll back" });
        f.o.movement(f.a, {
          action: "reserve",
          quantity: 100,
          partId: f.part.id,
          locationId: f.loc.id,
          projectId: f.p.id,
          taskId: f.t.id,
          note: "No stock exists",
        });
      }),
    /Insufficient/,
  );
  assert.equal(f.o.all(f.a, "project").length, 2);
  assert.equal(f.store.auditList(f.a.org).length, before);
});
