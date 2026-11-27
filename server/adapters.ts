import { randomUUID, createHmac } from "node:crypto";
import { lookup } from "node:dns/promises";
import { request } from "node:https";
import { isIP } from "node:net";
import { z } from "zod";
import { Store, type Actor, requireThat } from "./store.js";
import { domainEvents } from "./contracts.js";
type R = Record<string, any>;
export function adapterView(s: Store, a: Actor) {
  requireThat(a.role === "admin", "Administrator required", 403);
  return {
    adapters: s.db.prepare("SELECT * FROM adapters WHERE org=?").all(a.org),
    deliveries: s.db
      .prepare(
        "SELECT d.* FROM adapter_deliveries d JOIN adapters a ON a.id=d.adapter_id WHERE a.org=? ORDER BY d.rowid DESC LIMIT 200",
      )
      .all(a.org),
    eventTypes: domainEvents,
  };
}
export function saveAdapter(s: Store, a: Actor, raw: any) {
  requireThat(a.role === "admin", "Administrator required", 403);
  const b = z
    .object({
      id: z.string().optional(),
      version: z.number().int().optional(),
      name: z.string().trim().min(1).max(200),
      endpoint: z.url(),
      secretEnv: z.string().regex(/^FIELDOPS_WEBHOOK_[A-Z0-9_]+$/),
      enabled: z.boolean(),
      eventTypes: z.array(z.enum(domainEvents)).min(1),
    })
    .parse(raw);
  const url = new URL(b.endpoint);
  requireThat(
    url.protocol === "https:" && !url.username && !url.password && !url.hash,
    "Use an HTTPS webhook endpoint without embedded credentials",
  );
  if (b.enabled) {
    requireThat(
      (process.env.FIELDOPS_WEBHOOK_ALLOWED_HOSTS || "")
        .split(",")
        .map((x) => x.trim())
        .includes(url.hostname),
      "Installation operator must allow this webhook host",
    );
    requireThat(
      (process.env[b.secretEnv] || "").length >= 32,
      "Configure a signing secret of at least 32 characters in the named environment variable",
    );
  }
  const old = b.id
    ? (s.db
        .prepare("SELECT * FROM adapters WHERE org=? AND id=?")
        .get(a.org, b.id) as R)
    : undefined;
  if (b.id)
    requireThat(
      old && old.version === b.version,
      "Adapter changed; reload",
      409,
    );
  const id = old?.id || randomUUID(),
    version = (old?.version || 0) + 1,
    cursor =
      !old || (!old.enabled && b.enabled)
        ? (
            s.db
              .prepare(
                "SELECT coalesce(max(rowid),0) AS n FROM outbox WHERE org=?",
              )
              .get(a.org) as any
          ).n
        : old.cursor;
  s.db
    .prepare(
      "INSERT INTO adapters VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,endpoint=excluded.endpoint,secret_env=excluded.secret_env,enabled=excluded.enabled,event_types=excluded.event_types,cursor=excluded.cursor,version=excluded.version",
    )
    .run(
      id,
      a.org,
      b.name,
      b.endpoint,
      b.secretEnv,
      b.enabled ? 1 : 0,
      JSON.stringify(b.eventTypes),
      cursor,
      version,
      new Date().toISOString(),
    );
  s.audit(a, "adapter.configured", id, {
    name: b.name,
    endpoint: b.endpoint,
    enabled: b.enabled,
    eventTypes: b.eventTypes,
  });
  return { id, version };
}
export function retryAdapter(s: Store, a: Actor, raw: any) {
  requireThat(a.role === "admin", "Administrator required", 403);
  const adapter = s.db
    .prepare("SELECT id FROM adapters WHERE org=? AND id=?")
    .get(a.org, z.string().parse(raw.adapterId));
  requireThat(adapter, "Adapter not found", 404);
  const changed = s.db
    .prepare(
      "UPDATE adapter_deliveries SET state='pending',attempts=0,next_at=0,error=NULL WHERE adapter_id=? AND event_id=? AND state='dead-letter'",
    )
    .run(raw.adapterId, z.string().parse(raw.eventId));
  requireThat(changed.changes === 1, "Choose a dead-letter delivery");
  s.audit(a, "adapter.delivery_retried", raw.eventId, {
    adapterId: raw.adapterId,
  });
  return { ok: true };
}
function publicAddress(address: string) {
  if (isIP(address) === 6)
    return !/^(::|fc|fd|fe[89ab])/i.test(address) && !address.includes(".");
  const [a, b] = address.split(".").map(Number);
  return (
    isIP(address) === 4 &&
    a > 0 &&
    a !== 10 &&
    a !== 127 &&
    a !== 169 &&
    a < 224 &&
    !(a === 172 && b >= 16 && b <= 31) &&
    !(a === 192 && (b === 168 || b === 0 || b === 2)) &&
    !(a === 198 && (b === 18 || b === 19 || b === 51)) &&
    !(a === 203 && b === 0) &&
    !(a === 100 && b >= 64 && b <= 127)
  );
}
export async function postEvent(adapter: R, event: R) {
  const url = new URL(adapter.endpoint);
  requireThat(
    (process.env.FIELDOPS_WEBHOOK_ALLOWED_HOSTS || "")
      .split(",")
      .map((x) => x.trim())
      .includes(url.hostname),
    "Webhook host is no longer permitted",
  );
  const secret = process.env[adapter.secret_env] || "";
  requireThat(secret.length >= 32, "Webhook signing secret is not configured");
  const addresses = await lookup(url.hostname, { all: true });
  requireThat(
    addresses.length && addresses.every((a) => publicAddress(a.address)),
    "Webhook host must resolve only to public addresses",
  );
  const body = JSON.stringify(event),
    timestamp = String(Math.floor(Date.now() / 1000)),
    signature = createHmac("sha256", secret)
      .update(timestamp + "." + body)
      .digest("hex"),
    target = addresses[0];
  await new Promise<void>((resolve, reject) => {
    const req = request(
      url,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(body),
          "X-FieldOps-Event": event.id,
          "X-FieldOps-Timestamp": timestamp,
          "X-FieldOps-Signature": "sha256=" + signature,
        },
        lookup: ((_host: any, _options: any, callback: any) =>
          _options?.all
            ? callback(null, [target])
            : callback(null, target.address, target.family)) as any,
        timeout: 10000,
      },
      (res) => {
        res.resume();
        res.on("end", () =>
          res.statusCode && res.statusCode >= 200 && res.statusCode < 300
            ? resolve()
            : reject(new Error("Webhook returned HTTP " + res.statusCode)),
        );
      },
    );
    req.on("timeout", () => req.destroy(new Error("Webhook timed out")));
    req.on("error", reject);
    req.end(body);
  });
}
export async function processAdapters(s: Store, deliver = postEvent) {
  const adapters = s.db
    .prepare("SELECT * FROM adapters WHERE enabled=1")
    .all() as R[];
  for (const adapter of adapters) {
    s.tx(() => {
      const events = s.db
          .prepare(
            "SELECT rowid AS seq,* FROM outbox WHERE org=? AND rowid>? ORDER BY rowid LIMIT 200",
          )
          .all(adapter.org, adapter.cursor) as R[],
        types = JSON.parse(adapter.event_types);
      for (const e of events)
        if (types.includes(e.event_type))
          s.db
            .prepare(
              "INSERT OR IGNORE INTO adapter_deliveries VALUES(?,?,'pending',0,0,NULL,NULL)",
            )
            .run(adapter.id, e.id);
      if (events.length)
        s.db
          .prepare("UPDATE adapters SET cursor=? WHERE id=?")
          .run(events.at(-1)!.seq, adapter.id);
    });
    const pending = s.db
      .prepare(
        "SELECT d.*,e.org,e.kind,e.entity,e.event_type,e.payload,e.created_at FROM adapter_deliveries d JOIN outbox e ON e.id=d.event_id WHERE d.adapter_id=? AND d.state='pending' AND d.next_at<=? ORDER BY d.rowid LIMIT 50",
      )
      .all(adapter.id, Date.now()) as R[];
    for (const row of pending) {
      try {
        await deliver(adapter, {
          id: row.event_id,
          contractVersion: 1,
          organizationId: row.org,
          type: row.event_type,
          occurredAt: row.created_at,
          entityId: row.entity,
          data: JSON.parse(row.payload),
        });
        s.tx(() => {
          s.db
            .prepare("INSERT OR IGNORE INTO deliveries VALUES(?,?,?)")
            .run(row.event_id, adapter.id, new Date().toISOString());
          s.db
            .prepare(
              "UPDATE adapter_deliveries SET state='delivered',delivered_at=?,error=NULL WHERE adapter_id=? AND event_id=?",
            )
            .run(new Date().toISOString(), adapter.id, row.event_id);
        });
      } catch (e: any) {
        const attempts = row.attempts + 1;
        s.db
          .prepare(
            "UPDATE adapter_deliveries SET state=?,attempts=?,next_at=?,error=? WHERE adapter_id=? AND event_id=?",
          )
          .run(
            attempts >= 5 ? "dead-letter" : "pending",
            attempts,
            Date.now() + Math.min(3600000, 1000 * 2 ** attempts),
            String(e.message).slice(0, 300),
            adapter.id,
            row.event_id,
          );
      }
    }
  }
  return { adapters: adapters.length };
}
