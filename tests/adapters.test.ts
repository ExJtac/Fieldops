import { test } from "node:test";
import assert from "node:assert/strict";
import { Store } from "../server/store.js";
import {
  saveAdapter,
  processAdapters,
  retryAdapter,
  adapterView,
} from "../server/adapters.js";
test("adapter consumers isolate tenants, deliver once, retry and recover dead letters without exposing secrets", async () => {
  const s = new Store(":memory:");
  s.db.prepare("INSERT INTO organizations VALUES(?,?)").run("one", "One");
  s.db.prepare("INSERT INTO organizations VALUES(?,?)").run("two", "Two");
  const a = s.createUser(
      "one",
      "one@test.invalid",
      "One",
      "test-only-password",
      "admin",
    ),
    b = s.createUser(
      "two",
      "two@test.invalid",
      "Two",
      "test-only-password",
      "admin",
    );
  const oldHosts = process.env.FIELDOPS_WEBHOOK_ALLOWED_HOSTS,
    oldSecret = process.env.FIELDOPS_WEBHOOK_TEST;
  try {
    process.env.FIELDOPS_WEBHOOK_ALLOWED_HOSTS = "hooks.example.invalid";
    process.env.FIELDOPS_WEBHOOK_TEST = "test-secret-".repeat(4);
    const cfg = {
      name: "Test adapter",
      endpoint: "https://hooks.example.invalid/events",
      secretEnv: "FIELDOPS_WEBHOOK_TEST",
      enabled: true,
      eventTypes: ["ProjectProgressChanged"],
    };
    s.emit(a, "progress", "earlier", "ProjectProgressChanged", {
      projectId: "p",
    });
    const adapter = saveAdapter(s, a, cfg);
    s.emit(b, "progress", "other", "ProjectProgressChanged", {
      projectId: "other",
    });
    s.emit(a, "progress", "target", "ProjectProgressChanged", {
      projectId: "p",
      progress: 50,
    });
    const delivered: any[] = [];
    await processAdapters(s, async (_a, e) => {
      delivered.push(e);
    });
    assert.equal(delivered.length, 1);
    assert.equal(delivered[0].entityId, "target");
    assert.equal(delivered[0].contractVersion, 1);
    await processAdapters(s, async (_a, e) => {
      delivered.push(e);
    });
    assert.equal(delivered.length, 1);
    assert.equal(adapterView(s, b).adapters.length, 0);
    assert.ok(
      !JSON.stringify(adapterView(s, a)).includes(
        process.env.FIELDOPS_WEBHOOK_TEST,
      ),
    );
    s.emit(a, "progress", "retry", "ProjectProgressChanged", {
      projectId: "p",
    });
    for (let i = 0; i < 5; i++) {
      s.db.prepare("UPDATE adapter_deliveries SET next_at=0").run();
      await processAdapters(s, async () => {
        throw Error("Simulated provider outage");
      });
    }
    const row = s.db
      .prepare("SELECT * FROM adapter_deliveries WHERE state='dead-letter'")
      .get() as any;
    assert.equal(row.attempts, 5);
    assert.throws(
      () =>
        retryAdapter(s, b, { adapterId: adapter.id, eventId: row.event_id }),
      /not found/,
    );
    retryAdapter(s, a, { adapterId: adapter.id, eventId: row.event_id });
    await processAdapters(s, async (_a, e) => {
      delivered.push(e);
    });
    assert.equal(delivered.length, 2);
    assert.equal(s.db.prepare("SELECT count(*) n FROM deliveries").get()!.n, 2);
    assert.throws(
      () => saveAdapter(s, a, { ...cfg, endpoint: "http://localhost/events" }),
      /HTTPS/,
    );
  } finally {
    if (oldHosts === undefined)
      delete process.env.FIELDOPS_WEBHOOK_ALLOWED_HOSTS;
    else process.env.FIELDOPS_WEBHOOK_ALLOWED_HOSTS = oldHosts;
    if (oldSecret === undefined) delete process.env.FIELDOPS_WEBHOOK_TEST;
    else process.env.FIELDOPS_WEBHOOK_TEST = oldSecret;
    s.close();
  }
});
