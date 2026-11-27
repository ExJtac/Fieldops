import { createHmac, timingSafeEqual, randomUUID } from "node:crypto";
import { z } from "zod";
import { Store, type Actor, requireThat, hash } from "./store.js";
import { owns, entitlements } from "./tenants.js";
type R = Record<string, any>;
function limit(name: string, fallback: number) {
  return z.coerce
    .number()
    .int()
    .positive()
    .max(1000000)
    .parse(process.env[name] || fallback);
}
export function billingPlans() {
  return [
    {
      id: "materials",
      name: "Materials",
      materials: true,
      manpower: false,
      price: process.env.STRIPE_PRICE_MATERIALS || "",
    },
    {
      id: "manpower",
      name: "Manpower",
      materials: false,
      manpower: true,
      price: process.env.STRIPE_PRICE_MANPOWER || "",
    },
    {
      id: "both",
      name: "Materials + Manpower",
      materials: true,
      manpower: true,
      price: process.env.STRIPE_PRICE_BOTH || "",
    },
  ].map((p) => ({
    ...p,
    maxProjects: limit("FIELDOPS_PLAN_PROJECTS", 100),
    maxMembers: limit("FIELDOPS_PLAN_MEMBERS", 100),
    maxStorageMB: limit("FIELDOPS_PLAN_STORAGE_MB", 5000),
  }));
}
export function verifyStripe(
  raw: Buffer,
  signature: string,
  secret: string,
  now = Date.now(),
) {
  requireThat(secret.length >= 16, "Billing webhook is not configured", 503);
  const pairs = signature.split(",").map((s) => s.split("=")),
    timestamp = Number(pairs.find((p) => p[0] === "t")?.[1]);
  requireThat(
    Number.isInteger(timestamp) && Math.abs(now / 1000 - timestamp) <= 300,
    "Webhook timestamp is invalid",
    400,
  );
  const expected = createHmac("sha256", secret)
    .update(String(timestamp) + ".")
    .update(raw)
    .digest();
  requireThat(
    pairs.some(
      ([k, v]) =>
        k === "v1" &&
        /^[a-f0-9]{64}$/i.test(v || "") &&
        timingSafeEqual(expected, Buffer.from(v, "hex")),
    ),
    "Webhook signature is invalid",
    400,
  );
  const event = JSON.parse(raw.toString());
  return z
    .object({
      id: z.string().min(1),
      created: z.number().int(),
      type: z.string(),
      data: z.object({ object: z.record(z.string(), z.any()) }),
    })
    .parse(event);
}
export async function stripeCall(
  path: string,
  body?: URLSearchParams,
  key?: string,
  transport: typeof fetch = fetch,
) {
  requireThat(process.env.STRIPE_SECRET_KEY, "Stripe is not configured", 503);
  const r = await transport("https://api.stripe.com/v1/" + path, {
    method: body ? "POST" : "GET",
    headers: {
      Authorization: "Bearer " + process.env.STRIPE_SECRET_KEY,
      "Stripe-Version": "2026-11-18.endive",
      ...(body ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
      ...(key ? { "Idempotency-Key": key } : {}),
    },
    body: body?.toString(),
    signal: AbortSignal.timeout(15000),
  });
  const data = (await r.json()) as R;
  requireThat(
    r.ok,
    "Billing provider request failed; retry or contact the installation operator",
    502,
  );
  return data;
}
export function applySubscription(s: Store, event: R, subscription: R) {
  if (s.db.prepare("SELECT 1 FROM billing_events WHERE id=?").get(event.id))
    return { duplicate: true };
  const org = z.string().min(1).parse(subscription.metadata?.fieldops_org);
  requireThat(
    s.db.prepare("SELECT 1 FROM organizations WHERE id=?").get(org),
    "Unknown billing workspace",
    400,
  );
  const plan = billingPlans().find(
    (p) =>
      p.price &&
      subscription.items?.data?.some((l: R) => l.price?.id === p.price),
  );
  requireThat(plan, "Subscription price is not mapped to a FieldOps plan", 400);
  const prior = s.db
    .prepare("SELECT * FROM billing_accounts WHERE org=?")
    .get(org) as any;
  if (prior?.customer_id)
    requireThat(
      prior.customer_id === subscription.customer,
      "Billing customer does not match workspace",
      400,
    );
  if (!prior || event.created >= prior.last_event_at) {
    const active = ["active", "trialing"].includes(subscription.status),
      entitlement = {
        plan: plan.id,
        status: subscription.status,
        materials: active && plan.materials,
        manpower: active && plan.manpower,
        maxProjects: plan.maxProjects,
        maxMembers: plan.maxMembers,
        maxStorageMB: plan.maxStorageMB,
      };
    s.db
      .prepare(
        "INSERT INTO entitlements VALUES(?,?) ON CONFLICT(org) DO UPDATE SET body=excluded.body",
      )
      .run(org, JSON.stringify(entitlement));
    s.db
      .prepare(
        "INSERT INTO billing_accounts VALUES(?,?,?,?,?,?) ON CONFLICT(org) DO UPDATE SET customer_id=excluded.customer_id,subscription_id=excluded.subscription_id,plan=excluded.plan,status=excluded.status,last_event_at=excluded.last_event_at",
      )
      .run(
        org,
        subscription.customer,
        subscription.id,
        plan.id,
        subscription.status,
        event.created,
      );
    s.audit(
      { id: "billing-provider", org, name: "Billing provider", role: "admin" },
      "subscription.updated",
      org,
      { plan: plan.id, status: subscription.status, eventId: event.id },
    );
  }
  s.db
    .prepare("INSERT INTO billing_events VALUES(?,?,?,?)")
    .run(event.id, event.created, event.type, new Date().toISOString());
  return { received: true };
}
export async function receiveBilling(
  s: Store,
  raw: Buffer,
  signature: string,
  transport: typeof fetch = fetch,
) {
  requireThat(
    process.env.FIELDOPS_COMMERCIAL === "true",
    "Hosted billing is disabled",
    503,
  );
  const event = verifyStripe(
    raw,
    signature,
    process.env.STRIPE_WEBHOOK_SECRET || "",
  );
  if (s.db.prepare("SELECT 1 FROM billing_events WHERE id=?").get(event.id))
    return { duplicate: true };
  if (
    ![
      "customer.subscription.created",
      "customer.subscription.updated",
      "customer.subscription.deleted",
      "customer.subscription.paused",
      "customer.subscription.resumed",
    ].includes(event.type)
  )
    return { ignored: true };
  const id = z
    .string()
    .regex(/^sub_[A-Za-z0-9]+$/)
    .parse(event.data.object.id);
  // Retrieve canonical current state: webhook arrival order must not restore an obsolete entitlement.
  const current = await stripeCall(
    "subscriptions/" + encodeURIComponent(id),
    undefined,
    undefined,
    transport,
  );
  return s.tx(() => applySubscription(s, event, current));
}
export function billingView(s: Store, a: Actor) {
  return {
    entitlements: entitlements(s, a),
    configured:
      !!process.env.STRIPE_SECRET_KEY && !!process.env.STRIPE_WEBHOOK_SECRET,
    plans: billingPlans()
      .filter((p) => p.price)
      .map(({ price, ...p }) => p),
    account: owns(s, a)
      ? s.db
          .prepare("SELECT plan,status FROM billing_accounts WHERE org=?")
          .get(a.org) || null
      : null,
  };
}
export async function checkout(
  s: Store,
  a: Actor,
  planId: string,
  key: string,
  transport: typeof fetch = fetch,
) {
  requireThat(owns(s, a), "Workspace owner required for billing", 403);
  requireThat(
    process.env.FIELDOPS_COMMERCIAL === "true",
    "The community edition does not require a subscription",
  );
  requireThat(key.length >= 8 && key.length <= 200, "Idempotency key required");
  const plan = billingPlans().find((p) => p.id === planId && p.price);
  requireThat(plan, "Plan is not configured");
  const origin = z.url().parse(process.env.APP_ORIGIN);
  requireThat(
    origin.startsWith("https://"),
    "Hosted billing requires an HTTPS application origin",
  );
  const returnUrl = origin.replace(/\/$/, "") + (process.env.BASE_PATH || "/");
  const existing = s.db
    .prepare("SELECT * FROM billing_accounts WHERE org=?")
    .get(a.org) as any;
  requireThat(
    !existing ||
      ![
        "active",
        "trialing",
        "past_due",
        "unpaid",
        "paused",
        "incomplete",
      ].includes(existing.status),
    "Manage the existing subscription in the billing portal",
  );
  const body = new URLSearchParams({
    mode: "subscription",
    "line_items[0][price]": plan.price,
    "line_items[0][quantity]": "1",
    success_url: returnUrl + "?billing=returned",
    cancel_url: returnUrl,
    client_reference_id: a.org,
    "subscription_data[metadata][fieldops_org]": a.org,
  });
  if (existing?.customer_id) body.set("customer", existing.customer_id);
  const pending = s.tx(() => {
    const row = s.db
      .prepare("SELECT * FROM billing_checkout WHERE org=?")
      .get(a.org) as R;
    if (row && row.expires > Date.now()) {
      requireThat(
        row.plan === planId,
        "A checkout for another plan is pending; finish it or wait 31 minutes before choosing another plan",
        409,
      );
      return row;
    }
    const expires = Math.floor(Date.now() / 1000) + 1860;
    body.set("expires_at", String(expires));
    const next = {
      org: a.org,
      plan: planId,
      provider_key: randomUUID(),
      expires: expires * 1000,
      body: body.toString(),
      url: null,
    };
    s.db
      .prepare(
        "INSERT INTO billing_checkout VALUES(?,?,?,?,?,?) ON CONFLICT(org) DO UPDATE SET plan=excluded.plan,provider_key=excluded.provider_key,expires=excluded.expires,body=excluded.body,url=NULL",
      )
      .run(a.org, planId, next.provider_key, next.expires, next.body, null);
    return next;
  });
  if (pending.url) return { url: pending.url };
  const session = await stripeCall(
    "checkout/sessions",
    new URLSearchParams(pending.body),
    pending.provider_key,
    transport,
  );
  requireThat(
    typeof session.url === "string" &&
      session.url.startsWith("https://checkout.stripe.com/"),
    "Unexpected provider checkout URL",
    502,
  );
  s.db
    .prepare("UPDATE billing_checkout SET url=? WHERE org=? AND provider_key=?")
    .run(session.url, a.org, pending.provider_key);
  s.audit(a, "billing.checkout_opened", a.org, { plan: plan.id });
  return { url: session.url };
}
export async function billingPortal(
  s: Store,
  a: Actor,
  key: string,
  transport: typeof fetch = fetch,
) {
  requireThat(owns(s, a), "Workspace owner required for billing", 403);
  requireThat(
    process.env.FIELDOPS_COMMERCIAL === "true",
    "Hosted billing disabled",
  );
  requireThat(key.length >= 8, "Idempotency key required");
  const account = s.db
    .prepare("SELECT customer_id FROM billing_accounts WHERE org=?")
    .get(a.org) as any;
  requireThat(account?.customer_id, "No billing customer exists");
  const origin = z.url().parse(process.env.APP_ORIGIN);
  requireThat(origin.startsWith("https://"), "Hosted billing requires HTTPS");
  const session = await stripeCall(
    "billing_portal/sessions",
    new URLSearchParams({
      customer: account.customer_id,
      return_url: origin.replace(/\/$/, "") + (process.env.BASE_PATH || "/"),
    }),
    hash(a.org + ":portal:" + key),
    transport,
  );
  requireThat(
    typeof session.url === "string" &&
      session.url.startsWith("https://billing.stripe.com/"),
    "Unexpected provider portal URL",
    502,
  );
  return { url: session.url };
}
