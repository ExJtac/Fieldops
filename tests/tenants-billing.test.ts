import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac, randomUUID } from "node:crypto";
import { Store, hash } from "../server/store.js";
import { Operations } from "../server/domain.js";
import { Advanced } from "../server/advanced.js";
import {
  createTenant,
  addMember,
  tenantList,
  entitlements,
  guardEntitlement,
} from "../server/tenants.js";
import {
  verifyStripe,
  applySubscription,
  receiveBilling,
  checkout,
} from "../server/billing.js";
function fixture() {
  const s = new Store(":memory:");
  s.db.prepare("INSERT INTO organizations VALUES(?,?)").run("one", "First");
  const a = s.createUser(
      "one",
      "owner@test.invalid",
      "Owner",
      "test-only-password",
      "admin",
    ),
    o = new Operations(s);
  s.add(a, "settings", { separation: false });
  return { s, a, o };
}
test("memberships and session tenant selection isolate roles, grants and account deactivation", () => {
  const { s, a, o } = fixture();
  const p = o.create(a, "project", { name: "First private job" }),
    other = s.tx(() => createTenant(s, a, "Second"));
  assert.equal(tenantList(s, a).length, 2);
  assert.equal(o.snapshot(other).data.project.length, 0);
  assert.throws(() => o.ref(other, "project", p.id), /not found/);
  const p2 = o.create(other, "project", { name: "Second private job" }),
    worker = s.createUser(
      "one",
      "member@test.invalid",
      "Member",
      "test-only-password",
      "pm",
    );
  s.tx(() =>
    addMember(o, other, { email: "member@test.invalid", role: "viewer" }),
  );
  const second = s.user(worker.id, other.org);
  assert.equal(second.role, "viewer");
  assert.equal(s.user(worker.id, "one").role, "pm");
  const advanced = new Advanced(o);
  o.write(other, randomUUID(), {}, () =>
    advanced.grants(other, { userId: worker.id, projectIds: [p2.id] }),
  );
  assert.equal(o.all(second, "project").length, 1);
  assert.equal(o.all(worker, "project").length, 0);
  s.db
    .prepare(
      "INSERT INTO sessions(token,user_id,expires,org_id) VALUES(?,?,?,?)",
    )
    .run(
      hash("synthetic-session-token"),
      worker.id,
      Date.now() + 60000,
      other.org,
    );
  assert.equal(s.session("synthetic-session-token").org, other.org);
  s.db
    .prepare("UPDATE memberships SET active=0 WHERE org=? AND user_id=?")
    .run(other.org, worker.id);
  assert.throws(() => s.session("synthetic-session-token"), /inactive/);
  assert.equal(s.user(worker.id, "one").role, "pm");
  s.close();
});
test("community entitlements remain unlimited; hosted module and usage limits are distinct from roles", () => {
  const { s, a, o } = fixture();
  const previous = process.env.FIELDOPS_COMMERCIAL;
  try {
    process.env.FIELDOPS_COMMERCIAL = "false";
    assert.equal(entitlements(s, a).plan, "community");
    assert.equal(entitlements(s, a).maxProjects, null);
    process.env.FIELDOPS_COMMERCIAL = "true";
    assert.throws(
      () => o.create(a, "project", { name: "No subscription" }),
      /read-only/,
    );
    s.db
      .prepare("INSERT INTO entitlements VALUES(?,?)")
      .run(
        a.org,
        JSON.stringify({
          plan: "materials",
          status: "active",
          materials: true,
          manpower: false,
          maxProjects: 1,
          maxMembers: 1,
          maxStorageMB: 1,
        }),
      );
    o.create(a, "project", { name: "Within limit" });
    assert.throws(
      () => o.create(a, "project", { name: "Above limit" }),
      /limit/,
    );
    assert.throws(
      () =>
        o.create(a, "worker", { name: "Not entitled", trade: "Electrical" }),
      /Manpower/,
    );
    assert.throws(() => guardEntitlement(s, a, "member"), /limit/);
    assert.throws(
      () => guardEntitlement(s, a, "attachment", 1000001),
      /storage/,
    );
    process.env.FIELDOPS_COMMERCIAL = "false";
    o.create(a, "worker", {
      name: "Community includes manpower",
      trade: "Electrical",
    });
  } finally {
    if (previous === undefined) delete process.env.FIELDOPS_COMMERCIAL;
    else process.env.FIELDOPS_COMMERCIAL = previous;
    s.close();
  }
});
test("billing verifies raw signatures, retrieves canonical subscription state and suppresses duplicate/stale events", async () => {
  const { s, a } = fixture(),
    old = { ...process.env };
  try {
    process.env.FIELDOPS_COMMERCIAL = "true";
    process.env.STRIPE_PRICE_BOTH = "price_both";
    process.env.STRIPE_SECRET_KEY = "synthetic-provider-key";
    process.env.STRIPE_WEBHOOK_SECRET = "synthetic-signing-secret";
    process.env.APP_ORIGIN = "https://example.invalid";
    const now = Math.floor(Date.now() / 1000),
      event = {
        id: "evt_test1",
        type: "customer.subscription.updated",
        created: now,
        data: { object: { id: "sub_test", status: "active" } },
      },
      raw = Buffer.from(JSON.stringify(event)),
      signature =
        "t=" +
        now +
        ",v1=" +
        createHmac("sha256", process.env.STRIPE_WEBHOOK_SECRET)
          .update(now + ".")
          .update(raw)
          .digest("hex");
    assert.equal(
      verifyStripe(raw, signature, process.env.STRIPE_WEBHOOK_SECRET!).id,
      "evt_test1",
    );
    assert.throws(
      () =>
        verifyStripe(
          Buffer.from(raw.toString() + " "),
          signature,
          process.env.STRIPE_WEBHOOK_SECRET!,
        ),
      /signature/,
    );
    assert.throws(
      () =>
        verifyStripe(
          raw,
          signature,
          process.env.STRIPE_WEBHOOK_SECRET!,
          (now + 301) * 1000,
        ),
      /timestamp/,
    );
    let calls = 0;
    const subscription = {
      id: "sub_test",
      customer: "cus_test",
      metadata: { fieldops_org: a.org },
      items: { data: [{ price: { id: "price_both" } }] },
      status: "past_due",
    };
    const mock = async (input: any) => {
      calls++;
      assert.equal(input, "https://api.stripe.com/v1/subscriptions/sub_test");
      return new Response(JSON.stringify(subscription), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    };
    await receiveBilling(s, raw, signature, mock as typeof fetch);
    assert.equal(entitlements(s, a).status, "past_due");
    assert.equal(entitlements(s, a).materials, false);
    assert.deepEqual(
      await receiveBilling(s, raw, signature, mock as typeof fetch),
      { duplicate: true },
    );
    assert.equal(calls, 1);
    s.tx(() =>
      applySubscription(
        s,
        { ...event, id: "evt_old", created: now - 1 },
        { ...subscription, status: "active" },
      ),
    );
    assert.equal(entitlements(s, a).status, "past_due");
    s.tx(() =>
      applySubscription(
        s,
        { ...event, id: "evt_new", created: now + 1 },
        { ...subscription, status: "active" },
      ),
    );
    assert.equal(entitlements(s, a).materials, true);
    await assert.rejects(
      checkout(s, a, "both", "synthetic-retry-key", mock as typeof fetch),
      /existing subscription/,
    );
    assert.equal(calls, 1);
  } finally {
    for (const k of [
      "FIELDOPS_COMMERCIAL",
      "STRIPE_PRICE_BOTH",
      "STRIPE_SECRET_KEY",
      "STRIPE_WEBHOOK_SECRET",
      "APP_ORIGIN",
    ])
      if (old[k] === undefined) delete process.env[k];
      else process.env[k] = old[k];
    s.close();
  }
});

test("concurrent checkout requests share one expiring provider session and never activate entitlements", async () => {
  const { s, a } = fixture(),
    old = { ...process.env };
  try {
    process.env.FIELDOPS_COMMERCIAL = "true";
    process.env.STRIPE_PRICE_BOTH = "price_both";
    process.env.STRIPE_SECRET_KEY = "synthetic-provider-key";
    process.env.APP_ORIGIN = "https://example.invalid";
    const keys: string[] = [],
      bodies: string[] = [];
    const mock = async (_url: any, options: any) => {
      keys.push(options.headers["Idempotency-Key"]);
      bodies.push(options.body);
      await new Promise((r) => setTimeout(r, 5));
      return new Response(
        JSON.stringify({ url: "https://checkout.stripe.com/c/pay/synthetic" }),
        { status: 200 },
      );
    };
    const [first, second] = await Promise.all([
      checkout(s, a, "both", "client-key-one", mock as typeof fetch),
      checkout(s, a, "both", "client-key-two", mock as typeof fetch),
    ]);
    assert.deepEqual(first, second);
    assert.equal(keys[0], keys[1]);
    assert.equal(bodies[0], bodies[1]);
    assert.equal(
      (await checkout(s, a, "both", "client-key-three", mock as typeof fetch))
        .url,
      first.url,
    );
    assert.equal(keys.length, 2);
    assert.equal(entitlements(s, a).materials, false);
  } finally {
    for (const k of [
      "FIELDOPS_COMMERCIAL",
      "STRIPE_PRICE_BOTH",
      "STRIPE_SECRET_KEY",
      "APP_ORIGIN",
    ])
      if (old[k] === undefined) delete process.env[k];
      else process.env[k] = old[k];
    s.close();
  }
});
