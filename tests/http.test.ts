import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createApp } from "../server/app.js";
import { Store } from "../server/store.js";
import ExcelJS from "exceljs";

test("authenticated HTTP lifecycle, scoped exports, attachment isolation and hostile origins", async () => {
  const store = new Store(":memory:"),
    server = createApp(store).listen(0, "127.0.0.1");
  await new Promise<void>((r) => server.once("listening", r));
  const url = "http://127.0.0.1:" + (server.address() as any).port;
  let cookie = "";
  async function request(path: string, body?: any, opts: any = {}) {
    return fetch(url + path, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        ...(body
          ? {
              "Content-Type": "application/json",
              "Idempotency-Key": randomUUID(),
            }
          : {}),
        Cookie: cookie,
        ...opts.headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  }
  try {
    assert.equal((await request("/api/v1/workspace")).status, 401);
    let r = await request("/api/setup", {
      organization: "Test",
      email: "admin@test.invalid",
      name: "Admin",
      password: "A long test-only password",
      demo: true,
    });
    assert.equal(r.status, 200);
    cookie = r.headers.get("set-cookie")!.split(";")[0];
    assert.match(r.headers.get("set-cookie")!, /HttpOnly/);
    assert.match(r.headers.get("set-cookie")!, /SameSite=Strict/);
    assert.equal(
      (
        await request("/api/setup", {
          organization: "Again",
          email: "a@b.com",
          name: "Again",
          password: "another-long-password",
        })
      ).status,
      409,
    );
    const ws = (await (await request("/api/v1/workspace")).json()) as any;
    assert.equal(ws.data.worker.length, 4);
    const p = ws.data.project[0],
      po = ws.data.po[0],
      movement = ws.data.movement[0];
    r = await request(
      "/api/v1/records/project",
      { name: "Hostile" },
      { headers: { Origin: "https://attacker.invalid" } },
    );
    assert.equal(r.status, 403);
    r = await request(`/api/v1/purchase-orders/${po.id}/promises`, {
      version: po.version,
      lines: po.lines.map((l: any) => ({
        ...l,
        confirmedETA: "2026-12-10",
        ackDate: "2026-11-25",
        unitCost: 0,
        quantity: 1,
      })),
    });
    assert.equal(r.status, 200);
    const revised = (await r.json()) as any;
    assert.equal(revised.lines[0].quantity, 33);
    assert.equal(revised.lines[0].unitCost, 18);
    assert.equal(revised.lines[0].confirmedETA, "2026-12-10");
    const attachment = {
      kind: "movement",
      entity: movement.id,
      name: "receipt.pdf",
      mime: "application/pdf",
      base64: Buffer.from("%PDF-1.4\nTest fixture").toString("base64"),
    };
    r = await request("/api/v1/attachments", attachment);
    assert.equal(r.status, 200);
    const attached = (await r.json()) as any;
    assert.equal(
      (await request("/api/v1/attachments/" + attached.id)).status,
      200,
    );
    assert.equal(
      (
        await request("/api/v1/attachments", {
          ...attachment,
          mime: "image/png",
        })
      ).status,
      400,
    );
    r = await request(
      "/api/v1/reports/json?projectId=" + p.id + "&section=Section%201",
    );
    assert.equal(r.status, 200);
    const report = (await r.json()) as any;
    assert.ok(report.forecast.length);
    assert.ok(
      report.forecast.every(
        (f: any) => f.projectId === p.id && f.section === "Section 1",
      ),
    );
    r = await request("/api/v1/reports/xlsx?projectId=" + p.id);
    assert.equal(r.status, 200);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(Buffer.from(await r.arrayBuffer()) as any);
    assert.ok(wb.getWorksheet("Labor")!.rowCount > 1);
    assert.ok(wb.getWorksheet("Readiness")!.rowCount > 1);
    r = await request("/api/v1/users", {
      email: "viewer@test.invalid",
      name: "GC viewer",
      password: "Viewer test-only password",
      role: "viewer",
    });
    assert.equal(r.status, 200);
    const account = (await r.json()) as any;
    assert.equal(
      (
        await request("/api/v1/operations/grants", {
          userId: account.id,
          projectIds: [p.id],
          payroll: false,
        })
      ).status,
      200,
    );
    assert.equal(
      (await request("/api/v1/operations/publish", { projectId: p.id })).status,
      200,
    );
    await request("/api/logout", {});
    assert.equal((await request("/api/v1/workspace")).status, 401);
    r = await request("/api/login", {
      email: "viewer@test.invalid",
      password: "Viewer test-only password",
    });
    assert.equal(r.status, 200);
    cookie = r.headers.get("set-cookie")!.split(";")[0];
    const viewer = (await (await request("/api/v1/workspace")).json()) as any;
    assert.equal(viewer.data.worker, undefined);
    assert.equal(viewer.data.po, undefined);
    assert.equal(
      (
        await request("/api/v1/records/part", {
          partNumber: "X",
          description: "X",
          unit: "ea",
        })
      ).status,
      403,
    );
    assert.equal(
      (await request("/api/v1/attachments/" + attached.id)).status,
      403,
    );
    const vrep = (await (await request("/api/v1/reports/json")).json()) as any;
    assert.equal(vrep.forecast[0].actual, undefined);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((r) => server.close(() => r()));
    store.close();
  }
});

test("public demo rejects every mutation and never requires a shared password", async () => {
  process.env.DEMO_READ_ONLY = "true";
  const store = new Store(":memory:");
  store.db.prepare("INSERT INTO organizations VALUES(?,?)").run("demo", "Demo");
  store.createUser(
    "demo",
    "demo@test.invalid",
    "Demo",
    "not-a-shared-credential",
    "admin",
  );
  const demoActor = store.user(
    (store.db.prepare("SELECT id FROM users LIMIT 1").get() as any).id,
  );
  store.add(demoActor, "settings", { publicDemo: true });
  const server = createApp(store).listen(0, "127.0.0.1");
  delete process.env.DEMO_READ_ONLY;
  await new Promise<void>((r) => server.once("listening", r));
  const url = "http://127.0.0.1:" + (server.address() as any).port;
  try {
    const state = (await (
      await fetch(url + "/api/v1/workspace")
    ).json()) as any;
    assert.equal(state.readOnly, true);
    for (const path of [
      "/api/setup",
      "/api/login",
      "/api/v1/users",
      "/api/v1/records/project",
      "/api/v1/inventory/movements",
    ])
      assert.equal(
        (
          await fetch(url + path, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: "{}",
          })
        ).status,
        403,
      );
  } finally {
    server.closeAllConnections();
    await new Promise<void>((r) => server.close(() => r()));
    store.close();
  }
});

test("bulk crew time is atomic and password change revokes sessions", async () => {
  const store = new Store(":memory:");
  const server = createApp(store).listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const url = "http://127.0.0.1:" + (server.address() as any).port;
  let cookie = "";
  const post = (path: string, body: unknown) =>
    fetch(url + path, {
      method: "POST",
      headers: {
        Cookie: cookie,
        "Content-Type": "application/json",
        "Idempotency-Key": randomUUID(),
      },
      body: JSON.stringify(body),
    });
  try {
    let res = await post("/api/setup", {
      organization: "Crew test",
      email: "lead@test.invalid",
      name: "Lead",
      password: "Initial crew password",
      demo: true,
    });
    cookie = res.headers.get("set-cookie")!.split(";")[0];
    const state = (await (
      await fetch(url + "/api/v1/workspace", { headers: { Cookie: cookie } })
    ).json()) as any;
    const body = {
      crew: "Crew A",
      projectId: state.data.project[0].id,
      taskId: "conduit",
      date: "2026-12-02",
      start: 7,
      regular: 8,
    };
    res = await post("/api/v1/crews/time", body);
    assert.equal(res.status, 200);
    assert.equal(((await res.json()) as any).count, 4);
    res = await post("/api/v1/crews/time", body);
    assert.equal(res.status, 409);
    assert.equal(
      store.list(state.actor.org, "time").filter((t) => t.date === "2026-12-02")
        .length,
      4,
    );
    res = await post("/api/v1/me/password", {
      currentPassword: "wrong",
      password: "Replacement crew password",
    });
    assert.equal(res.status, 403);
    res = await post("/api/v1/me/password", {
      currentPassword: "Initial crew password",
      password: "Replacement crew password",
    });
    assert.equal(res.status, 200);
    assert.equal(
      (await fetch(url + "/api/v1/workspace", { headers: { Cookie: cookie } }))
        .status,
      401,
    );
    assert.equal(
      (
        await post("/api/login", {
          email: "lead@test.invalid",
          password: "Initial crew password",
        })
      ).status,
      401,
    );
    assert.equal(
      (
        await post("/api/login", {
          email: "lead@test.invalid",
          password: "Replacement crew password",
        })
      ).status,
      200,
    );
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    store.close();
  }
});

test("advanced HTTP routes enforce grants, payroll permission, retention preview and downloadable reports", async () => {
  const store = new Store(":memory:"),
    server = createApp(store).listen(0, "127.0.0.1");
  await new Promise<void>((r) => server.once("listening", r));
  const url = "http://127.0.0.1:" + (server.address() as any).port;
  let cookie = "";
  const request = (path: string, body?: any) =>
    fetch(url + path, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        Cookie: cookie,
        "Content-Type": "application/json",
        "Idempotency-Key": randomUUID(),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  try {
    let r = await request("/api/setup", {
      organization: "QA",
      email: "admin@test.invalid",
      name: "Admin",
      password: "Test-only-password-long",
      demo: true,
    });
    cookie = r.headers.get("set-cookie")!.split(";")[0];
    const ws = (await (await request("/api/v1/workspace")).json()) as any,
      actor = ws.actor,
      p = ws.data.project[0],
      po = ws.data.po[0];
    assert.ok(
      ((await (await request("/api/v1/operations")).json()) as any).events
        .length > 0,
    );
    r = await request("/api/v1/records/shipment", {
      projectId: p.id,
      poId: po.id,
      reference: "HTTP split 1",
      lines: [{ lineId: po.lines[0].id, quantity: 10 }],
    });
    assert.equal(r.status, 200);
    const shipment = (await r.json()) as any;
    r = await request(`/api/v1/records/shipment/${shipment.id}/transition`, {
      version: 1,
      status: "Shipped",
    });
    assert.equal(r.status, 200);
    assert.equal(
      (
        await request("/api/v1/operations/rate", {
          workerId: ws.data.worker[0].id,
          effective: "2026-01-01",
          rate: 1,
          overtimeMultiplier: 1.5,
          currency: "USD",
        })
      ).status,
      403,
    );
    const bytes = Buffer.from("%PDF-1.4 QA old attachment");
    store.db
      .prepare(
        "INSERT INTO attachments(id,org,kind,entity,name,mime,bytes,created_at,author) VALUES(?,?,?,?,?,?,?,?,?)",
      )
      .run(
        "old-file",
        actor.org,
        "po",
        po.id,
        "old.pdf",
        "application/pdf",
        bytes,
        "2020-01-01T00:00:00Z",
        actor.id,
      );
    const preview = (await (
      await request("/api/v1/retention/preview", { days: 365 })
    ).json()) as any;
    assert.equal(preview.attachments.length, 1);
    assert.equal(
      (
        await request("/api/v1/retention/apply", {
          days: 365,
          token: "stale",
          confirm: "DELETE ATTACHMENTS",
        })
      ).status,
      409,
    );
    assert.equal((await request("/api/v1/attachments/old-file")).status, 200);
    assert.equal(
      (
        await request("/api/v1/retention/apply", {
          days: 365,
          token: preview.token,
          confirm: "DELETE ATTACHMENTS",
        })
      ).status,
      200,
    );
    assert.equal((await request("/api/v1/attachments/old-file")).status, 404);
    assert.ok(store.auditList(actor.org).length);
    r = await request(
      "/api/v1/analytics/pdf?projectId=" + p.id + "&table=Deliveries",
    );
    assert.equal(r.status, 200);
    assert.equal(
      Buffer.from(await r.arrayBuffer())
        .subarray(0, 5)
        .toString(),
      "%PDF-",
    );
    r = await request("/api/v1/organization/export");
    assert.equal(r.status, 200);
    const exported = (await r.json()) as any;
    assert.equal(exported.schemaVersion, 7);
    assert.ok(exported.revisions.length);
    assert.equal(exported.users, undefined);
    r = await request("/api/v1/users", {
      name: "Scoped PM",
      email: "pm@test.invalid",
      password: "Test-only-password-long",
      role: "pm",
    });
    const pm = (await r.json()) as any;
    await request("/api/v1/operations/grants", {
      userId: pm.id,
      projectIds: [p.id],
      payroll: false,
    });
    await request("/api/logout", {});
    r = await request("/api/login", {
      email: "pm@test.invalid",
      password: "Test-only-password-long",
    });
    cookie = r.headers.get("set-cookie")!.split(";")[0];
    assert.equal((await request("/api/v1/timeline/po/" + po.id)).status, 403);
    assert.equal((await request("/api/v1/organization/export")).status, 403);
    assert.equal(
      (
        await request("/api/v1/operations/grants", {
          userId: pm.id,
          projectIds: [],
          payroll: true,
        })
      ).status,
      403,
    );
    const pmReport = (await (
      await request("/api/v1/analytics/view")
    ).json()) as any;
    assert.equal(pmReport.tables.Spend, undefined);
    assert.equal(
      (
        await request(
          "/api/v1/analytics/view?projectId=" + ws.data.project[1].id,
        )
      ).status,
      403,
    );
  } finally {
    server.closeAllConnections();
    await new Promise<void>((r) => server.close(() => r()));
    store.close();
  }
});

test("supplier portal isolates vendor records, blocks internal endpoints, and requires explicit document sharing", async () => {
  const { Operations } = await import("../server/domain.js"),
    { Advanced } = await import("../server/advanced.js");
  const store = new Store(":memory:");
  store.db
    .prepare("INSERT INTO organizations VALUES(?,?)")
    .run("org", "Supplier test");
  const admin = store.createUser(
      "org",
      "buyer@test.invalid",
      "Buyer",
      "test-only-password",
      "admin",
    ),
    o = new Operations(store),
    advanced = new Advanced(o);
  store.add(admin, "settings", { separation: false });
  const p = o.create(admin, "project", { name: "Shared job" }),
    supplier = o.create(admin, "supplier", { name: "Approved supplier" }),
    other = o.create(admin, "supplier", { name: "Other supplier" }),
    part = o.create(admin, "part", {
      partNumber: "V1",
      description: "Vendor item",
      unit: "ea",
    });
  let po = o.create(admin, "po", {
    projectId: p.id,
    supplierId: supplier.id,
    number: "V-PO",
    notes: "Internal pricing negotiation",
    lines: [{ partId: part.id, quantity: 5, unitCost: 10 }],
  });
  for (const status of ["Submitted", "Approved", "Issued"])
    po = o.transition(admin, "po", po.id, { version: po.version, status });
  const privatePo = o.create(admin, "po", {
    projectId: p.id,
    supplierId: other.id,
    number: "OTHER-PO",
    lines: [{ partId: part.id, quantity: 5, unitCost: 2 }],
  });
  let rfq = o.create(admin, "rfq", {
    projectId: p.id,
    supplierId: supplier.id,
    partId: part.id,
    quantity: 5,
  });
  rfq = o.transition(admin, "rfq", rfq.id, { version: 1, status: "Recorded" });
  const vendor = store.createUser(
    "org",
    "supplier@test.invalid",
    "Supplier contact",
    "test-only-password",
    "vendor",
    undefined,
    supplier.id,
  );
  o.write(admin, randomUUID(), {}, () =>
    advanced.grants(admin, { userId: vendor.id, projectIds: [p.id] }),
  );
  for (const [id, visible] of [
    ["private", 0],
    ["shared", 1],
  ] as const)
    store.db
      .prepare(
        "INSERT INTO attachments(id,org,kind,entity,name,mime,bytes,created_at,author,vendor_visible) VALUES(?,?,?,?,?,?,?,?,?,?)",
      )
      .run(
        id,
        "org",
        "po",
        po.id,
        id + ".pdf",
        "application/pdf",
        Buffer.from("%PDF-test"),
        new Date().toISOString(),
        admin.id,
        visible,
      );
  const server = createApp(store).listen(0, "127.0.0.1");
  await new Promise<void>((r) => server.once("listening", r));
  const url = "http://127.0.0.1:" + (server.address() as any).port;
  let cookie = "";
  const request = (path: string, body?: any) =>
    fetch(url + path, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        Cookie: cookie,
        "Content-Type": "application/json",
        "Idempotency-Key": randomUUID(),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  try {
    const login = await request("/api/login", {
      email: "supplier@test.invalid",
      password: "test-only-password",
    });
    assert.equal(login.status, 200);
    cookie = login.headers.get("set-cookie")!.split(";")[0];
    const ws = (await (await request("/api/v1/workspace")).json()) as any;
    assert.equal(ws.data.po.length, 1);
    assert.equal(ws.data.po[0].id, po.id);
    assert.equal(ws.data.po[0].notes, undefined);
    assert.equal(ws.data.worker, undefined);
    assert.equal(ws.data.rfq.length, 1);
    for (const path of [
      "/api/v1/operations",
      "/api/v1/financial",
      "/api/v1/reports/json",
      "/api/v1/timeline/po/" + po.id,
      "/api/v1/organization/export",
    ])
      assert.equal((await request(path)).status, 403, path);
    assert.equal(
      (await request("/api/v1/records/project", { name: "Unpermitted" }))
        .status,
      403,
    );
    const ownQuote = await request("/api/v1/records/quote", {
      projectId: p.id,
      supplierId: supplier.id,
      partId: part.id,
      rfqId: rfq.id,
      quantity: 5,
      unit: "ea",
      unitCost: 10,
    });
    assert.equal(ownQuote.status, 200);
    assert.equal(
      (
        await request("/api/v1/records/quote", {
          projectId: p.id,
          supplierId: other.id,
          partId: part.id,
          rfqId: rfq.id,
          quantity: 5,
          unit: "ea",
          unitCost: 2,
        })
      ).status,
      403,
    );
    assert.equal(
      (
        await request("/api/v1/operations/vendorPromise", {
          id: privatePo.id,
          version: 1,
          lines: [],
        })
      ).status,
      403,
    );
    const confirmed = await request("/api/v1/operations/vendorPromise", {
      id: po.id,
      version: po.version,
      lines: po.lines.map((l: any) => ({
        id: l.id,
        ackDate: "2026-12-01",
        confirmedETA: "2026-12-08",
        quantity: 1,
        unitCost: 0,
      })),
    });
    assert.equal(confirmed.status, 200);
    const current = (await confirmed.json()) as any;
    assert.equal(current.lines[0].quantity, 5);
    assert.equal(current.lines[0].unitCost, 10);
    const files = (await (
      await request("/api/v1/attachments?kind=po&id=" + po.id)
    ).json()) as any[];
    assert.equal(files.length, 1);
    assert.equal(files[0].id, "shared");
    assert.equal((await request("/api/v1/attachments/private")).status, 403);
    assert.equal((await request("/api/v1/attachments/shared")).status, 200);
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
    store.close();
  }
});
