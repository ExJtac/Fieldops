import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import ExcelJS from "exceljs";
import { createApp } from "../server/app.js";
import { Store } from "../server/store.js";
import { processEvents } from "../server/events.js";
type R = Record<string, any>;
const password = "synthetic-end-to-end-only";
async function harness() {
  const store = new Store(":memory:"),
    server = createApp(store).listen(0, "127.0.0.1");
  await new Promise<void>((r) => server.once("listening", r));
  const url = "http://127.0.0.1:" + (server.address() as any).port;
  const client = (cookie = "") => {
    const request = async (
      path: string,
      body?: any,
      method = body === undefined ? "GET" : "POST",
      expected = 200,
      key = randomUUID(),
    ) => {
      const response = await fetch(url + path, {
        method,
        headers: {
          Cookie: cookie,
          "Content-Type": "application/json",
          "Idempotency-Key": key,
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const data = (response.headers.get("Content-Type") || "").includes(
        "application/json",
      )
        ? await response.json()
        : Buffer.from(await response.arrayBuffer());
      assert.equal(
        response.status,
        expected,
        `${method} ${path}: ${JSON.stringify(data)}`,
      );
      return data as any;
    };
    return {
      request,
      create: (kind: string, body: R) =>
        request("/api/v1/records/" + kind, body),
      op: (name: string, body: R) =>
        request("/api/v1/operations/" + name, body),
      ws: () => request("/api/v1/workspace"),
      transition: (kind: string, r: R, status: string, more: R = {}) =>
        request(`/api/v1/records/${kind}/${r.id}/transition`, {
          version: r.version,
          status,
          ...more,
        }),
      edit: (kind: string, r: R, body: R) =>
        request(
          `/api/v1/records/${kind}/${r.id}`,
          { ...body, version: r.version },
          "PATCH",
        ),
    };
  };
  const setup = await fetch(url + "/api/setup", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      organization: "Acceptance lab",
      email: "owner@test.invalid",
      name: "Acceptance owner",
      password,
      demo: false,
    }),
  });
  assert.equal(setup.status, 200);
  const owner = ((await setup.json()) as R).actor,
    admin = client(setup.headers.get("set-cookie")!.split(";")[0]);
  const login = async (email: string) => {
    const res = await fetch(url + "/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    assert.equal(res.status, 200, await res.text());
    return client(res.headers.get("set-cookie")!.split(";")[0]);
  };
  const account = async (role: string, projects: string[], extra: R = {}) => {
    const email = role + "-" + randomUUID() + "@test.invalid",
      user = await admin.request("/api/v1/users", {
        name: "Synthetic " + role,
        email,
        password,
        role,
        ...extra,
      });
    await admin.op("grants", { userId: user.id, projectIds: projects });
    return { user, client: await login(email) };
  };
  const close = async () => {
    await new Promise<void>((resolve, reject) =>
      server.close((e) => (e ? reject(e) : resolve())),
    );
    store.close();
  };
  return { store, server, admin, owner, account, login, close };
}

test("E2E materials: reviewed XLSX BOM → supplier quote → split delivery → reservation → return/credit → cancellation and reports", async () => {
  const h = await harness(),
    a = h.admin;
  try {
    const project = await a.create("project", {
        name: "Acceptance project",
        stagingDays: 2,
      }),
      task = await a.create("task", {
        projectId: project.id,
        name: "Install cable",
        section: "Section 1",
        unit: "ea",
        target: 100,
        unitHours: 0.5,
        baselineStart: "2026-12-07",
        baselineEnd: "2026-12-11",
      }),
      otherProject = await a.create("project", { name: "Other project" }),
      otherTask = await a.create("task", {
        projectId: otherProject.id,
        name: "Other cable",
        section: "Other",
        unit: "ea",
        target: 50,
      });
    const part = await a.create("part", {
        partNumber: "CABLE-A",
        manufacturer: "Lab",
        description: "Cable drop",
        unit: "ea",
        aliases: ["CA", "CB"],
        csi: "27",
        unspsc: "26121609",
        barcode: "0123456789",
      }),
      location = await a.create("location", { name: "Site", bin: "A1" }),
      warehouse = await a.create("location", { name: "Warehouse", bin: "B2" }),
      supplier = await a.create("supplier", {
        name: "Test vendor",
        email: "vendor@test.invalid",
      });
    const buyer = (await h.account("purchasing", [project.id])).client,
      foreman = (await h.account("foreman", [project.id])).client,
      vendor = (
        await h.account("vendor", [project.id], { supplierId: supplier.id })
      ).client;
    const wb = new ExcelJS.Workbook(),
      sheet = wb.addWorksheet("BOM");
    sheet.addRow([
      "partNumber",
      "manufacturer",
      "unit",
      "quantity",
      "taskId",
      "needBy",
    ]);
    sheet.addRow([
      "CA",
      "Lab",
      "ea",
      { formula: "50*2", result: 100 },
      task.id,
      new Date("2026-12-07T00:00:00Z"),
    ]);
    const decoded = await buyer.request("/api/v1/imports/preview", {
      projectId: project.id,
      format: "xlsx",
      base64: Buffer.from(await wb.xlsx.writeBuffer()).toString("base64"),
    });
    assert.equal(decoded.preview[0].errors.length, 0);
    assert.equal(decoded.rows[0].needBy, "2026-12-07");
    assert.equal(decoded.rows[0].quantity, 100);
    const duplicated = await buyer.request("/api/v1/imports/preview", {
      projectId: project.id,
      rows: [
        ...decoded.rows,
        { ...decoded.rows[0], partNumber: "CB", unit: "box" },
      ],
    });
    assert.match(duplicated.preview[1].errors.join(" "), /Duplicate/);
    assert.match(duplicated.preview[1].errors.join(" "), /Unit mismatch/);
    assert.equal(duplicated.preview[1].original.unit, "box");
    await buyer.request("/api/v1/imports/commit", {
      projectId: project.id,
      source: "Reviewed estimate lab",
      sourceVersion: "v1",
      rows: decoded.rows,
      reviewTokens: decoded.preview.map((r: R) => r.reviewToken),
    });
    const rfqs = await buyer.op("shortageRfqs", {
      projectId: project.id,
      supplierId: supplier.id,
    });
    assert.equal(rfqs.count, 1);
    let rfq = await buyer.transition("rfq", rfqs.records[0], "Recorded");
    let quote = await vendor.create("quote", {
      projectId: project.id,
      rfqId: rfq.id,
      supplierId: supplier.id,
      partId: part.id,
      unit: "ea",
      quantity: 100,
      unitCost: 10,
      freight: 20,
      tax: 5,
      currency: "USD",
      leadMin: 5,
      leadMax: 10,
      requestDate: "2026-11-01",
      responseDate: "2026-11-02",
      originalText: "Vendor original: CABLE-A 100 units",
    });
    const file = await vendor.request("/api/v1/attachments", {
      kind: "quote",
      entity: quote.id,
      name: "quote.pdf",
      mime: "application/pdf",
      base64: Buffer.from("%PDF-1.4\nSynthetic quote").toString("base64"),
    });
    assert.ok(file.id);
    quote = await a.transition("quote", quote, "Approved");
    const comparison = await buyer.request(
      `/api/v1/materials/compare?projectId=${project.id}&partId=${part.id}&quantity=100&currency=USD`,
    );
    assert.equal(comparison.rows[0].landedTotal, 1025);
    let po = await buyer.op("quoteToPo", {
      id: quote.id,
      quantity: 100,
      number: "E2E-PO",
    });
    po = await buyer.edit("po", po, {
      lines: po.lines.map((l: R) => ({ ...l, taskId: task.id })),
      receivingLocationId: location.id,
      notes: "INTERNAL-DO-NOT-SHARE",
    });
    po = await buyer.transition("po", po, "Submitted");
    po = await a.transition("po", po, "Approved");
    po = await buyer.transition("po", po, "Issued");
    const before = await buyer.request(
      `/api/v1/materials/workspace?projectId=${project.id}`,
    );
    assert.equal(before.lines[0].orders[0].forecastFrom, "");
    po = await vendor.op("vendorPromise", {
      id: po.id,
      version: po.version,
      lines: po.lines.map((l: R) => ({
        id: l.id,
        ackDate: "2026-11-27",
        confirmedETA: "2026-12-08",
      })),
    });
    assert.ok(
      !JSON.stringify(po).includes("INTERNAL-DO-NOT-SHARE"),
      "Supplier mutation responses must be redacted",
    );
    const risk = await buyer.request(
      `/api/v1/materials/workspace?projectId=${project.id}`,
    );
    assert.equal(risk.lines[0].risk, "Late delivery");
    assert.equal(risk.tasks[0].baselineStart, "2026-12-07");
    let shipment = await vendor.create("shipment", {
      projectId: project.id,
      poId: po.id,
      reference: "SPLIT-60",
      carrier: "Lab carrier",
      tracking: "TEST-TRACK",
      expectedDate: "2026-12-08",
      lines: [{ lineId: po.lines[0].id, quantity: 60 }],
    });
    shipment = await vendor.transition("shipment", shipment, "Shipped");
    shipment = await vendor.transition("shipment", shipment, "Delivered", {
      actualDate: "2026-12-08",
    });
    const movement = {
      partId: part.id,
      locationId: location.id,
      projectId: project.id,
      poId: po.id,
      lineId: po.lines[0].id,
      note: "Synthetic receipt evidence",
    };
    const key = randomUUID(),
      receipt = await foreman.request(
        "/api/v1/inventory/movements",
        {
          ...movement,
          action: "receive",
          quantity: 60,
          shipmentId: shipment.id,
        },
        "POST",
        200,
        key,
      );
    assert.equal(
      (
        await foreman.request(
          "/api/v1/inventory/movements",
          {
            ...movement,
            action: "receive",
            quantity: 60,
            shipmentId: shipment.id,
          },
          "POST",
          200,
          key,
        )
      ).id,
      receipt.id,
    );
    const photo = await foreman.request("/api/v1/attachments", {
      kind: "movement",
      entity: receipt.id,
      name: "packing-slip.pdf",
      mime: "application/pdf",
      base64: Buffer.from("%PDF-1.4\nSynthetic packing slip").toString(
        "base64",
      ),
    });
    assert.ok(
      (await foreman.request("/api/v1/attachments/" + photo.id))
        .subarray(0, 5)
        .equals(Buffer.from("%PDF-")),
    );
    await foreman.request("/api/v1/inventory/movements", {
      ...movement,
      action: "reserve",
      taskId: task.id,
      quantity: 50,
    });
    await a.request(
      "/api/v1/inventory/movements",
      {
        ...movement,
        action: "reserve",
        projectId: otherProject.id,
        taskId: otherTask.id,
        quantity: 20,
      },
      "POST",
      409,
    );
    let report = await buyer.request(
      `/api/v1/analytics/view?projectId=${project.id}&section=Section%201`,
    );
    assert.deepEqual(
      [
        report.tables.Deliveries[0].ordered,
        report.tables.Deliveries[0].netReceived,
        report.tables.Deliveries[0].remaining,
      ],
      [100, 60, 40],
    );
    const timeline = await buyer.request(
      `/api/v1/materials/timeline?projectId=${project.id}&partId=${part.id}`,
    );
    assert.ok(timeline.entries.some((e: R) => e.kind === "shipment"));
    assert.ok(timeline.attachments.some((f: R) => f.id === photo.id));
    po = await buyer.op("backorder", {
      id: po.id,
      version: po.version,
      lineId: po.lines[0].id,
      quantity: 40,
      reason: "Supplier remaining balance",
    });
    await foreman.request("/api/v1/inventory/movements", {
      ...movement,
      action: "receive",
      quantity: 40,
    });
    po = (await buyer.ws()).data.po[0];
    assert.equal(
      po.lines[0].backordered,
      0,
      "Fully delivered lines must clear outstanding backorders",
    );
    await foreman.request("/api/v1/inventory/movements", {
      ...movement,
      action: "issue",
      taskId: task.id,
      quantity: 50,
    });
    await foreman.request("/api/v1/inventory/movements", {
      ...movement,
      action: "install",
      taskId: task.id,
      quantity: 50,
    });
    await foreman.request("/api/v1/inventory/movements", {
      ...movement,
      action: "transfer",
      toLocationId: warehouse.id,
      quantity: 10,
    });
    const returned = await foreman.request("/api/v1/inventory/movements", {
      ...movement,
      action: "return",
      quantity: 5,
    });
    let credit = await buyer.create("credit", {
      projectId: project.id,
      poId: po.id,
      returnMovementId: returned.id,
      amount: 50,
      reference: "CREDIT-5",
      reason: "Returned five surplus units",
    });
    await a.transition("credit", credit, "Approved");
    po = await buyer.transition("po", po, "Cancelled");
    report = await buyer.request(
      `/api/v1/analytics/view?projectId=${project.id}&section=Section%201`,
    );
    assert.equal(
      report.tables.Spend[0].receivedMaterialValue,
      950,
      "Cancellation must retain received value",
    );
    assert.equal(report.tables.Spend[0].openMaterialCommitment, 0);
    const privateWs = await foreman.ws();
    assert.equal(privateWs.data.po[0].lines[0].unitCost, undefined);
    await foreman.request(
      "/api/v1/materials/compare?projectId=" +
        project.id +
        "&partId=" +
        part.id +
        "&quantity=100&currency=USD",
      undefined,
      "GET",
      403,
    );
    const pdf = await buyer.request(
      "/api/v1/analytics/pdf?projectId=" + project.id,
    );
    assert.ok(pdf.subarray(0, 5).equals(Buffer.from("%PDF-")));
    const xlsx = await buyer.request(
      "/api/v1/analytics/xlsx?projectId=" + project.id,
    );
    const book = new ExcelJS.Workbook();
    await book.xlsx.load(xlsx);
    assert.ok(book.getWorksheet("Spend")!.rowCount > 1);
  } finally {
    await h.close();
  }
});

test("E2E change control enforces separate approval and carries a change through BOM, labor and schedule", async () => {
  const h = await harness(),
    a = h.admin;
  try {
    const p = await a.create("project", { name: "Changes" }),
      t = await a.create("task", {
        projectId: p.id,
        name: "Install",
        section: "1",
        target: 10,
        unitHours: 1,
        baselineStart: "2026-12-01",
        baselineEnd: "2026-12-02",
      }),
      part = await a.create("part", {
        partNumber: "P",
        manufacturer: "Lab",
        description: "Part",
        unit: "ea",
      }),
      pm = (await h.account("pm", [p.id])).client;
    const settings = (await a.ws()).data.settings[0];
    await a.request("/api/v1/settings", {
      version: settings.version,
      separation: true,
    });
    let change = await pm.create("change", {
      projectId: p.id,
      title: "Add scope",
      description: "GC adds five units",
      source: "Synthetic change directive",
    });
    await pm.request(
      `/api/v1/records/change/${change.id}/transition`,
      { version: change.version, status: "Approved" },
      "POST",
      403,
    );
    change = await a.transition("change", change, "Approved");
    const rows = [
        {
          partNumber: "P",
          manufacturer: "Lab",
          unit: "ea",
          quantity: 15,
          taskId: t.id,
          changeId: change.id,
        },
      ],
      preview = await pm.request("/api/v1/imports/preview", {
        projectId: p.id,
        rows,
      });
    await pm.request("/api/v1/imports/commit", {
      projectId: p.id,
      rows,
      reviewTokens: preview.preview.map((x: R) => x.reviewToken),
      source: "Scope change",
      sourceVersion: "change-1",
    });
    assert.equal(
      (await pm.ws()).data.requirement[0].changeId,
      change.id,
      "BOM must retain the originating change",
    );
    let reforecast = await pm.create("reforecast", {
      projectId: p.id,
      taskId: t.id,
      remainingHours: 15,
      reason: "Five additional units",
      changeId: change.id,
    });
    await pm.request(
      `/api/v1/records/reforecast/${reforecast.id}/transition`,
      { version: reforecast.version, status: "Approved" },
      "POST",
      403,
    );
    await a.transition("reforecast", reforecast, "Approved");
    let hold = await pm.create("hold", {
      projectId: p.id,
      taskId: t.id,
      reason: "Awaiting revised material delivery",
      proposedStart: "2026-12-03",
      changeId: change.id,
    });
    await pm.request(
      `/api/v1/records/hold/${hold.id}/transition`,
      { version: hold.version, status: "Approved" },
      "POST",
      403,
    );
    hold = await a.transition("hold", hold, "Approved");
    let revision = await pm.create("scheduleRevision", {
      projectId: p.id,
      name: "Change forecast",
      reason: "Approved revised arrival",
      mode: "forecast",
      changeId: change.id,
      dates: [{ taskId: t.id, start: "2026-12-03", finish: "2026-12-05" }],
    });
    await a.transition("scheduleRevision", revision, "Approved");
    await a.transition("hold", hold, "Resolved");
    const saved = (await a.ws()).data.task[0];
    assert.equal(saved.baselineStart, "2026-12-01");
    assert.equal(saved.forecastStart, "2026-12-03");
    assert.equal((await a.ws()).forecast[0].remaining, 15);
  } finally {
    await h.close();
  }
});

test("E2E manpower: dated crew → dispatch → worker review/production → payroll/export → availability and forecast scenarios", async () => {
  const h = await harness(),
    a = h.admin;
  try {
    const p = await a.create("project", {
        name: "Four-person crew",
        fieldBudget: 1793.95,
        pmBudget: 179.395,
      }),
      t = await a.create("task", {
        projectId: p.id,
        name: "33 CAT6A drops",
        section: "Section 1",
        target: 33,
        unit: "ea",
        unitHours: 0.5,
        materialRequired: false,
        instructions: "Use approved route",
        permits: "Daily access permit",
        requiredSkill: "Cable",
      }),
      other = await a.create("task", {
        projectId: p.id,
        name: "Future section",
        section: "Section 2",
        target: 100,
        materialRequired: false,
      }),
      p2 = await a.create("project", { name: "Conflicting job" }),
      t2 = await a.create("task", {
        projectId: p2.id,
        name: "Other assignment",
        section: "General",
        target: 10,
        materialRequired: false,
      });
    const pm = (await h.account("pm", [p.id, p2.id])).client,
      foreman = (await h.account("foreman", [p.id])).client,
      crew = await pm.create("crew", {
        name: "Cable crew",
        trade: "Low voltage",
        paidBreak: 0.25,
      });
    const workers: R[] = [];
    for (let i = 0; i < 4; i++) {
      const w = await pm.create("worker", {
        name: "Synthetic worker " + i,
        trade: "Low voltage",
        kind: i === 3 ? "contractor" : "employee",
        skills: [{ name: "Cable", expires: "2027-12-31" }],
      });
      workers.push(w);
      await pm.create("crewMembership", {
        crewId: crew.id,
        workerId: w.id,
        from: "2026-12-01",
        to: "2028-11-30",
        role: "Installer",
      });
    }
    const workerAccount = await h.account("worker", [], {
        workerId: workers[0].id,
      }),
      worker = workerAccount.client;
    const settings = (await a.ws()).data.settings[0];
    await a.op("dispatchSetting", { enabled: true, version: settings.version });
    const range = {
      projectId: p.id,
      taskId: t.id,
      workerIds: workers.map((w) => w.id),
      crewId: crew.id,
      from: "2026-12-07",
      to: "2026-12-07",
      start: 7,
      hours: 8,
      role: "Installer",
    };
    const preview = await pm.request("/api/v1/planning/range-preview", range);
    assert.equal(preview.count, 4);
    assert.ok(preview.records.every((r: R) => r.conflicts.length === 0));
    const assignments = await pm.request("/api/v1/planning/range", range);
    assert.equal(
      assignments.records.reduce((n: number, r: R) => n + r.hours, 0),
      32,
    );
    const conflict = {
      projectId: p2.id,
      taskId: t2.id,
      workerId: workers[0].id,
      date: "2026-12-07",
      start: 7,
      hours: 8,
    };
    assert.ok(
      (
        await pm.request("/api/v1/assignments/preview", conflict)
      ).conflicts.some((x: string) => x.includes("overlapping")),
    );
    await pm.request("/api/v1/records/assignment", conflict, "POST", 409);
    processEvents(h.store, 10000);
    let ws = await worker.ws();
    assert.equal(ws.data.assignment.length, 1);
    assert.equal(ws.data.worker.length, 1);
    assert.equal(
      ws.data.task.find((r: R) => r.id === t.id).instructions,
      "Use approved route",
    );
    const notice = ws.data.notice[0];
    assert.ok(notice);
    await worker.transition("notice", notice, "Acknowledged");
    const code = await pm.create("costCode", {
      projectId: p.id,
      code: "FIELD",
      description: "Field installation",
      laborType: "field",
    });
    const entry = await worker.op("fieldEntry", {
      projectId: p.id,
      taskId: t.id,
      workerId: workers[0].id,
      date: "2026-12-07",
      start: 7,
      regular: 8,
      overtime: 0,
      costCodeId: code.id,
      quantity: 33,
      unit: "ea",
      notes: "Synthetic full task completion",
    });
    ws = await pm.ws();
    assert.equal(ws.forecast.find((f: R) => f.taskId === t.id).actual, 0);
    assert.equal(ws.forecast.find((f: R) => f.taskId === t.id).installed, 0);
    let time = await worker.transition("time", entry.time, "Submitted");
    time = await pm.transition("time", time, "Approved");
    await pm.transition("time", time, "Locked");
    await pm.transition("production", entry.production, "Approved");
    await worker.create("checkin", {
      projectId: p.id,
      taskId: t.id,
      workerId: workers[0].id,
      date: "2026-12-07",
      status: "Present",
    });
    ws = await pm.ws();
    const progress = ws.forecast.find((f: R) => f.taskId === t.id);
    assert.equal(progress.progress, 100);
    assert.equal(progress.earned, 16.5);
    assert.equal(progress.actual, 8);
    assert.equal(
      ws.forecast.find((f: R) => f.taskId === other.id).installed,
      0,
    );
    assert.equal(
      ws.data.project.find((p0: R) => p0.id === p.id).fieldBudget,
      1793.95,
    );
    assert.equal(progress.allocatedBudget, null);
    const availability = await worker.create("availability", {
      projectId: p.id,
      workerId: workers[0].id,
      date: "2026-12-08",
      hours: 8,
      reason: "Private personal appointment",
    });
    await pm.transition("availability", availability, "Approved");
    const nextDay = await pm.request("/api/v1/planning/range-preview", {
      ...range,
      from: "2026-12-08",
      to: "2026-12-08",
    });
    assert.equal(nextDay.count, 3);
    assert.equal(nextDay.skipped.length, 1);
    const board = await pm.request(
      `/api/v1/resources/availability?projectId=${p.id}&from=2026-12-08&to=2026-12-08`,
    );
    assert.equal(
      board.find((r: R) => r.workerId === workers[0].id).capacity,
      0,
    );
    assert.equal(
      board.find((r: R) => r.workerId === workers[0].id).crew,
      "Cable crew",
    );
    const ownBoard = await worker.request(
      `/api/v1/resources/availability?from=2026-12-07&to=2026-12-08`,
    );
    assert.equal(ownBoard.length, 2);
    assert.ok(ownBoard.every((r: R) => r.workerId === workers[0].id));
    assert.ok(
      !JSON.stringify(await foreman.ws()).includes(
        "Private personal appointment",
      ),
    );
    const rf = await pm.create("reforecast", {
      projectId: p.id,
      taskId: other.id,
      remainingHours: 96,
      reason: "Remaining future scope",
    });
    await pm.transition("reforecast", rf, "Approved");
    const scenario = {
      projectId: p.id,
      taskId: other.id,
      start: "2026-12-11",
      hours: 8,
      rate: 25,
      overtimeMultiplier: 1.5,
    };
    const four = await pm.request("/api/v1/planning/scenario", {
        ...scenario,
        crew: 4,
      }),
      six = await pm.request("/api/v1/planning/scenario", {
        ...scenario,
        crew: 6,
        saturdays: true,
      }),
      overtime = await pm.request("/api/v1/planning/scenario", {
        ...scenario,
        crew: 4,
        hours: 10,
      });
    assert.equal(four.days, 3);
    assert.equal(six.days, 2);
    assert.ok(overtime.overtime > 0);
    assert.equal((await pm.ws()).data.assignment.length, 4);
    const finance = await h.account("finance", [p.id]);
    await finance.client.request(
      "/api/v1/analytics/view?projectId=" +
        p.id +
        "&from=2026-12-07&to=2026-12-07&payroll=true&consent=confirmed",
      undefined,
      "GET",
      403,
    );
    await a.op("grants", {
      userId: finance.user.id,
      projectIds: [p.id],
      payroll: true,
    });
    await finance.client.op("rate", {
      workerId: workers[0].id,
      effective: "2026-01-01",
      rate: 25,
      overtimeMultiplier: 1.5,
      currency: "USD",
      reason: "Synthetic effective rate",
    });
    const payroll = await finance.client.request(
      "/api/v1/analytics/view?projectId=" +
        p.id +
        "&from=2026-12-07&to=2026-12-07&payroll=true&consent=confirmed",
    );
    assert.equal(payroll.tables.Payroll.length, 1);
    assert.equal(payroll.tables.Payroll[0].modeledGross, 200);
    const bulk = await foreman.request("/api/v1/crews/time", {
      crewId: crew.id,
      projectId: p.id,
      taskId: other.id,
      date: "2026-12-09",
      start: 7,
      regular: 8,
      overtime: 0,
      costCodeId: code.id,
    });
    assert.equal(bulk.count, 4, "Dated crew memberships must drive bulk time");
    assert.ok(bulk.records.every((r: R) => r.costCodeId === code.id));
    const analytics = await pm.request(
      "/api/v1/workforce?projectId=" + p.id + "&from=2026-12-07&to=2026-12-08",
    );
    assert.equal(analytics.TradeSiteHeadcount[0].headcount, 4);
    assert.equal(analytics.CrewProductivity[0].crew, "Cable crew");
    assert.equal(analytics.CrewProductivity[0].hours, 8);
    assert.equal(analytics.SkillCoverage[0].qualifiedHeadcount, 4);
    const viewer = await h.account("viewer", [p.id]);
    assert.equal((await viewer.client.ws()).forecast.length, 0);
    await a.op("publish", { projectId: p.id });
    const published = await viewer.client.ws();
    assert.equal(
      published.forecast.find((f: R) => f.taskId === t.id).progress,
      100,
    );
    assert.equal(published.data.worker, undefined);
    assert.ok(!JSON.stringify(published).includes("Synthetic worker"));
  } finally {
    await h.close();
  }
});

test("E2E import, custody and inspection: revised external PO → quarantine → serial warranty → amendment", async () => {
  const h = await harness(),
    a = h.admin;
  try {
    const p = await a.create("project", { name: "Custody lab" }),
      t = await a.create("task", {
        projectId: p.id,
        name: "Install equipment",
        section: "S1",
        target: 4,
        unitHours: 2,
        baselineStart: "2026-12-01",
        baselineEnd: "2026-12-04",
      }),
      part = await a.create("part", {
        partNumber: "SERIAL-1",
        description: "Equipment",
        unit: "ea",
      }),
      supplier = await a.create("supplier", { name: "Supplier" }),
      loc = await a.create("location", { name: "Receiving" });
    const body = {
      projectId: p.id,
      supplierId: supplier.id,
      number: "EXTERNAL-1",
      source: "external.xlsx",
      sourceVersion: "1",
      currency: "USD",
      freight: 0,
      tax: 0,
      rows: [
        {
          externalLineId: "a",
          partNumber: part.partNumber,
          manufacturer: "",
          quantity: 4,
          unit: "ea",
          unitCost: 30,
          taskId: t.id,
        },
      ],
    };
    const preview = await a.request("/api/v1/intake/po/preview", body);
    let po = (
      await a.request("/api/v1/intake/po/commit", {
        ...body,
        token: preview.token,
      })
    ).record;
    await a.request(
      "/api/v1/intake/po/commit",
      { ...body, token: preview.token },
      "POST",
      409,
    );
    for (const status of ["Submitted", "Approved", "Issued"])
      po = await a.transition("po", po, status);
    const movement = {
      partId: part.id,
      locationId: loc.id,
      projectId: p.id,
      poId: po.id,
      lineId: po.lines[0].id,
      note: "Synthetic inspection acceptance",
    };
    await a.request("/api/v1/inventory/movements", {
      ...movement,
      action: "receive",
      quantity: 3,
      condition: "Quarantine",
    });
    await a.request(
      "/api/v1/inventory/movements",
      { ...movement, action: "reserve", quantity: 1, taskId: t.id },
      "POST",
      409,
    );
    await a.request("/api/v1/inventory/movements", {
      ...movement,
      action: "inspect",
      quantity: 3,
      condition: "Good",
    });
    const receipt = await a.request("/api/v1/inventory/movements", {
      ...movement,
      action: "receive",
      quantity: 1,
      condition: "Good",
    });
    let asset = await a.create("asset", {
      projectId: p.id,
      partId: part.id,
      receiptId: receipt.id,
      serial: "ACCEPT-SN-1",
      warrantyUntil: "2028-12-01",
    });
    for (const action of ["reserve", "issue", "install"])
      asset = await a.op("assetMove", {
        id: asset.id,
        version: asset.version,
        projectId: p.id,
        taskId: t.id,
        action,
        note: "Acceptance custody transfer",
      });
    assert.equal(asset.status, "Installed");
    const revision = {
        ...body,
        sourceVersion: "2",
        rows: [{ ...body.rows[0], quantity: 6 }],
      },
      review = await a.request("/api/v1/intake/po/preview", revision),
      amendment = (
        await a.request("/api/v1/intake/po/commit", {
          ...revision,
          token: review.token,
        })
      ).record;
    await a.transition("poAmendment", amendment, "Approved");
    po = (await a.ws()).data.po[0];
    assert.equal(po.lines[0].quantity, 6);
    assert.equal(po.lines[0].id, movement.lineId);
    const adapted = await a.request("/api/v1/intake/decode", {
      mode: "estimate-json",
      source: {
        bomSnapshot: { id: "estimate-acceptance", pmHours: "3" },
        revisionNumber: 2,
        lineItemsSnapshot: [
          {
            id: "source",
            partNumber: part.partNumber,
            manufacturer: "",
            quantity: 4,
            laborHours: "2.5",
          },
        ],
      },
    });
    const estimate = {
        projectId: p.id,
        estimateId: adapted.estimateId,
        sourceVersion: adapted.sourceVersion,
        sourceHash: adapted.sourceHash,
        source: "Reviewed estimate JSON",
        fieldBudget: 10,
        pmBudget: 3,
        rows: [{ ...adapted.lines[0], unit: "ea", taskId: t.id }],
        allocations: [{ taskId: t.id, hours: 8 }],
      },
      ep = await a.request("/api/v1/intake/estimate/preview", estimate);
    await a.request("/api/v1/intake/estimate/commit", {
      ...estimate,
      token: ep.token,
    });
    const ws = await a.ws();
    assert.equal(ws.data.project[0].fieldBudget, 10);
    assert.equal(ws.data.task[0].allocatedHours, 8);
    assert.equal(ws.data.task[0].baselineStart, "2026-12-01");
    assert.equal(ws.data.requirement[0].quantity, 4);
    assert.equal(
      (await a.request("/api/v1/analytics/view?projectId=" + p.id)).tables
        .Warranty[0].serial,
      "ACCEPT-SN-1",
    );
    const badDate = await a.request("/api/v1/imports/preview", {
      projectId: p.id,
      rows: [
        {
          partNumber: part.partNumber,
          manufacturer: "",
          unit: "ea",
          quantity: 4,
          taskId: t.id,
          needBy: "2026-02-30",
        },
      ],
    });
    assert.match(badDate.preview[0].errors.join(" "), /calendar date/);
    const invalid = new ExcelJS.Workbook();
    invalid.addWorksheet("BOM").addRow(["quantity", "quantity"]);
    await a.request(
      "/api/v1/intake/decode",
      {
        format: "xlsx",
        base64: Buffer.from(await invalid.xlsx.writeBuffer()).toString(
          "base64",
        ),
      },
      "POST",
      400,
    );
  } finally {
    await h.close();
  }
});

test("E2E scheduling and account boundaries require fresh overrides, assigned time, separate approval and available seats", async () => {
  const h = await harness(),
    a = h.admin,
    commercial = process.env.FIELDOPS_COMMERCIAL;
  try {
    const p = await a.create("project", { name: "Assigned" }),
      p2 = await a.create("project", { name: "Unassigned" }),
      t = await a.create("task", {
        projectId: p.id,
        name: "Task",
        section: "S1",
        materialRequired: false,
      }),
      t2 = await a.create("task", {
        projectId: p2.id,
        name: "Other",
        section: "S2",
        materialRequired: false,
      }),
      w = await a.create("worker", { name: "Worker", trade: "Electrical" });
    await a.create("leave", { workerId: w.id, date: "2026-12-01", hours: 8 });
    await a.create("leave", { workerId: w.id, date: "2026-12-02", hours: 8 });
    let assignment = await a.create("assignment", {
      projectId: p.id,
      taskId: t.id,
      workerId: w.id,
      date: "2026-12-01",
      hours: 8,
      override: "Manager reviewed December first only",
    });
    await a.request(
      "/api/v1/assignments/" + assignment.id,
      { version: assignment.version, date: "2026-12-02" },
      "PATCH",
      409,
    );
    assignment = await a.request(
      "/api/v1/assignments/" + assignment.id,
      {
        version: assignment.version,
        date: "2026-12-02",
        override: "Manager reviewed December second explicitly",
      },
      "PATCH",
    );
    assert.equal(assignment.date, "2026-12-02");
    const worker = (
      await h.account("worker", [p.id, p2.id], { workerId: w.id })
    ).client;
    let time = await worker.create("time", {
      projectId: p.id,
      taskId: t.id,
      workerId: w.id,
      date: "2026-12-02",
      regular: 8,
    });
    await worker.request(
      "/api/v1/records/time/" + time.id,
      { version: time.version, projectId: p2.id, taskId: t2.id },
      "PATCH",
      403,
    );
    const supplier = await a.create("supplier", { name: "Supplier" }),
      part = await a.create("part", {
        partNumber: "P",
        description: "Part",
        unit: "ea",
      }),
      buyer = (await h.account("admin", [p.id])).client;
    let po = await a.create("po", {
      projectId: p.id,
      supplierId: supplier.id,
      number: "APPROVAL",
      lines: [{ partId: part.id, quantity: 2, unitCost: 5 }],
    });
    po = await buyer.edit("po", po, { notes: "Buyer changed commitment" });
    po = await buyer.transition("po", po, "Submitted");
    let settings = (await a.ws()).data.settings[0];
    await a.request("/api/v1/settings", {
      version: settings.version,
      separation: true,
    });
    await buyer.request(
      `/api/v1/records/po/${po.id}/transition`,
      { version: po.version, status: "Approved" },
      "POST",
      403,
    );
    await a.request(
      `/api/v1/records/po/${po.id}/transition`,
      { version: po.version, status: "Approved" },
      "POST",
      403,
    );
    const approver = (await h.account("admin", [p.id])).client;
    await approver.transition("po", po, "Approved");
    const levelScope = {
        projectId: p.id,
        from: "2026-12-02",
        to: "2026-12-04",
      },
      level = await a.request("/api/v1/planning/level-preview", levelScope);
    const applied = await a.request("/api/v1/planning/level-apply", {
      ...levelScope,
      token: level.token,
      selected: [assignment.id],
    });
    assert.equal(
      (await a.ws()).data.assignment.find((r: R) => r.id === assignment.id)
        .date,
      "2026-12-03",
    );
    await a.request("/api/v1/planning/level-undo", {
      id: applied.id,
      version: applied.version,
    });
    assert.equal(
      (await a.ws()).data.assignment.find((r: R) => r.id === assignment.id)
        .date,
      "2026-12-02",
    );
    const inactive = await h.account("foreman", [p.id]);
    await a.request("/api/v1/users/" + inactive.user.id + "/active", {
      active: false,
    });
    const count = Number(
      (
        h.store.db
          .prepare(
            "SELECT count(*) n FROM memberships WHERE org=? AND active=1",
          )
          .get(h.owner.org) as any
      ).n,
    );
    h.store.db.prepare("INSERT INTO entitlements VALUES(?,?)").run(
      h.owner.org,
      JSON.stringify({
        plan: "full",
        status: "active",
        materials: true,
        manpower: true,
        maxMembers: count,
        maxProjects: null,
        maxStorageMB: null,
      }),
    );
    process.env.FIELDOPS_COMMERCIAL = "true";
    await a.request(
      "/api/v1/users/" + inactive.user.id + "/active",
      { active: true },
      "POST",
      402,
    );
  } finally {
    if (commercial === undefined) delete process.env.FIELDOPS_COMMERCIAL;
    else process.env.FIELDOPS_COMMERCIAL = commercial;
    await h.close();
  }
});

test("E2E reconciliation: conversions, approved alternate stock, damage, replacement and audited time/production corrections", async () => {
  const h = await harness(),
    a = h.admin;
  try {
    const p = await a.create("project", { name: "Reconciliation" }),
      task = await a.create("task", {
        projectId: p.id,
        name: "Equipment install",
        section: "S1",
        target: 10,
        unitHours: 2,
      }),
      part = await a.create("part", {
        partNumber: "ORIGINAL",
        description: "Original equipment",
        unit: "ea",
      }),
      alternate = await a.create("part", {
        partNumber: "ALTERNATE",
        description: "Equivalent equipment",
        unit: "ea",
      }),
      loc = await a.create("location", { name: "Store" }),
      supplier = await a.create("supplier", { name: "Supplier" });
    const conversion = await a.create("conversion", {
      partId: part.id,
      fromUnit: "box",
      toUnit: "ea",
      factor: 5,
      reason: "Manufacturer packs five units",
    });
    await a.transition("conversion", conversion, "Approved");
    const rows = [
        {
          partNumber: part.partNumber,
          manufacturer: "",
          unit: "box",
          quantity: 2,
          taskId: task.id,
          conversionId: conversion.id,
        },
      ],
      review = await a.request("/api/v1/imports/preview", {
        projectId: p.id,
        rows,
      });
    await a.request("/api/v1/imports/commit", {
      projectId: p.id,
      rows,
      reviewTokens: review.preview.map((r: R) => r.reviewToken),
      sourceVersion: "1",
    });
    assert.equal((await a.ws()).data.requirement[0].quantity, 10);
    const sub = await a.create("substitution", {
      projectId: p.id,
      taskId: task.id,
      originalPartId: part.id,
      replacementPartId: alternate.id,
      reason: "Approved compatible equivalent",
    });
    await a.transition("substitution", sub, "Approved");
    let po = await a.create("po", {
      projectId: p.id,
      supplierId: supplier.id,
      number: "ALTERNATE-PO",
      lines: [
        { partId: alternate.id, quantity: 10, unitCost: 20, taskId: task.id },
      ],
    });
    for (const status of ["Submitted", "Approved", "Issued"])
      po = await a.transition("po", po, status);
    const stock = {
      projectId: p.id,
      partId: alternate.id,
      locationId: loc.id,
      poId: po.id,
      lineId: po.lines[0].id,
      note: "Synthetic reconciliation evidence",
    };
    await a.request("/api/v1/inventory/movements", {
      ...stock,
      action: "receive",
      quantity: 10,
    });
    const reserve = await a.request("/api/v1/inventory/movements", {
      ...stock,
      action: "reserve",
      taskId: task.id,
      quantity: 10,
    });
    assert.equal((await a.ws()).readiness[0].status, "Ready");
    await a.request("/api/v1/inventory/movements", {
      ...stock,
      action: "reverse",
      referenceId: reserve.id,
      quantity: 10,
    });
    assert.equal((await a.ws()).readiness[0].status, "Blocked");
    const damage = await a.create("adjustment", {
      projectId: p.id,
      partId: alternate.id,
      locationId: loc.id,
      action: "damage",
      quantity: -1,
      reason: "Damaged during inspection",
    });
    await a.transition("adjustment", damage, "Approved");
    assert.equal(
      (await a.ws()).data.movement.filter((r: R) => r.action === "damage")
        .length,
      1,
    );
    const replacement = await a.create("po", {
      projectId: p.id,
      supplierId: supplier.id,
      number: "REPLACEMENT-PO",
      replacesPoId: po.id,
      lines: [
        { partId: alternate.id, quantity: 1, unitCost: 0, taskId: task.id },
      ],
    });
    assert.equal(replacement.replacesPoId, po.id);
    const w = await a.create("worker", {
        name: "Installer",
        trade: "Low voltage",
        skills: [{ name: "Certified", expires: "2027-12-31" }],
      }),
      template = await a.create("crewTemplate", {
        name: "Certified single-person crew",
        trade: "Low voltage",
        size: 1,
        roles: [{ role: "Lead", count: 1, skill: "Certified" }],
      });
    const built = await a.request("/api/v1/planning/template", {
      id: template.id,
      crew: "Reconciliation crew",
      workerIds: [w.id],
      date: "2026-12-01",
    });
    assert.equal(built.workers[0].crewRole, "Lead");
    let time = await a.create("time", {
      projectId: p.id,
      taskId: task.id,
      workerId: w.id,
      date: "2026-12-01",
      regular: 8,
    });
    for (const status of ["Submitted", "Approved", "Locked"])
      time = await a.transition("time", time, status);
    assert.equal((await a.ws()).forecast[0].actual, 8);
    time = await a.transition("time", time, "Correction requested", {
      reason: "Correct two nonworking hours",
    });
    assert.equal((await a.ws()).forecast[0].actual, 8);
    time = await a.transition("time", time, "Rejected", {
      reason: "Reopen reviewed correction",
    });
    time = await a.edit("time", time, { regular: 6 });
    for (const status of ["Submitted", "Approved"])
      time = await a.transition("time", time, status);
    assert.equal((await a.ws()).forecast[0].actual, 6);
    let production = await a.create("production", {
      projectId: p.id,
      taskId: task.id,
      date: "2026-12-01",
      quantity: 8,
      unit: "ea",
    });
    production = await a.transition("production", production, "Approved");
    const correction = await a.create("productionCorrection", {
      projectId: p.id,
      productionId: production.id,
      quantity: 5,
      reason: "Three units need rework",
    });
    assert.equal((await a.ws()).forecast[0].earned, 16);
    await a.transition("productionCorrection", correction, "Approved");
    assert.equal((await a.ws()).forecast[0].earned, 10);
    const history = await a.request(
      "/api/v1/timeline/production/" + production.id,
    );
    assert.ok(
      JSON.stringify(history).includes("Three units need rework") ||
        JSON.stringify(history).includes('"quantity":8'),
    );
  } finally {
    await h.close();
  }
});
