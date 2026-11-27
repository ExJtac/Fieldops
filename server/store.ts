import { eventContract } from "./contracts.js";
import { DatabaseSync } from "node:sqlite";
import {
  randomUUID,
  randomBytes,
  scryptSync,
  timingSafeEqual,
  createHash,
} from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
export type Role =
  | "admin"
  | "pm"
  | "purchasing"
  | "foreman"
  | "worker"
  | "viewer"
  | "finance"
  | "vendor";
export type Actor = {
  id: string;
  org: string;
  name: string;
  role: Role;
  workerId?: string;
  supplierId?: string;
};
export type RecordData = {
  id: string;
  version: number;
  createdAt: string;
  updatedAt: string;
  createdBy: string;
  [key: string]: any;
};
export class Fault extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}
export function requireThat(
  ok: unknown,
  message: string,
  status = 400,
): asserts ok {
  if (!ok) throw new Fault(message, status);
}
export const hash = (s: string) => createHash("sha256").update(s).digest("hex");
export function passwordHash(p: string) {
  const salt = randomBytes(16).toString("hex");
  return salt + ":" + scryptSync(p, salt, 64).toString("hex");
}
export function passwordMatches(p: string, stored: string) {
  const [salt, key] = stored.split(":");
  return timingSafeEqual(Buffer.from(key, "hex"), scryptSync(p, salt, 64));
}
export class Store {
  db: DatabaseSync;
  constructor(path: string) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec(`
 PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
 CREATE TABLE IF NOT EXISTS migrations(version INTEGER PRIMARY KEY,applied_at TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS organizations(id TEXT PRIMARY KEY,name TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY,org TEXT NOT NULL REFERENCES organizations(id),email TEXT NOT NULL UNIQUE,name TEXT NOT NULL,password TEXT NOT NULL,role TEXT NOT NULL,worker_id TEXT,active INTEGER NOT NULL DEFAULT 1);
 CREATE TABLE IF NOT EXISTS project_access(org TEXT NOT NULL,user_id TEXT NOT NULL,project_id TEXT NOT NULL,PRIMARY KEY(org,user_id,project_id));
 CREATE TABLE IF NOT EXISTS financial_access(org TEXT NOT NULL,user_id TEXT NOT NULL,payroll INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(org,user_id));
 CREATE TABLE IF NOT EXISTS labor_rates(org TEXT NOT NULL,worker_id TEXT NOT NULL,effective TEXT NOT NULL,rate REAL NOT NULL CHECK(rate>=0),overtime_multiplier REAL NOT NULL CHECK(overtime_multiplier>=1),currency TEXT NOT NULL,PRIMARY KEY(org,worker_id,effective));
 CREATE TABLE IF NOT EXISTS outbox(id TEXT PRIMARY KEY,org TEXT NOT NULL,actor TEXT NOT NULL,kind TEXT NOT NULL,entity TEXT NOT NULL,event_type TEXT NOT NULL,payload TEXT NOT NULL,state TEXT NOT NULL DEFAULT 'pending',attempts INTEGER NOT NULL DEFAULT 0,next_at INTEGER NOT NULL DEFAULT 0,error TEXT,created_at TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS deliveries(event_id TEXT NOT NULL,consumer TEXT NOT NULL,processed_at TEXT NOT NULL,PRIMARY KEY(event_id,consumer));
 CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),expires INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS records(org TEXT NOT NULL REFERENCES organizations(id),kind TEXT NOT NULL,id TEXT NOT NULL,body TEXT NOT NULL CHECK(json_valid(body)),PRIMARY KEY(org,kind,id));
 CREATE INDEX IF NOT EXISTS record_project ON records(org,kind,json_extract(body,'$.projectId'));
 CREATE UNIQUE INDEX IF NOT EXISTS po_number ON records(org,json_extract(body,'$.number')) WHERE kind='po';
 CREATE TABLE IF NOT EXISTS audit(seq INTEGER PRIMARY KEY AUTOINCREMENT,id TEXT NOT NULL UNIQUE,org TEXT NOT NULL,actor TEXT NOT NULL,at TEXT NOT NULL,action TEXT NOT NULL,entity TEXT NOT NULL,detail TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS revisions(org TEXT NOT NULL,kind TEXT NOT NULL,id TEXT NOT NULL,version INTEGER NOT NULL,body TEXT NOT NULL,PRIMARY KEY(org,kind,id,version));
 CREATE TABLE IF NOT EXISTS attachments(id TEXT PRIMARY KEY,org TEXT NOT NULL,kind TEXT NOT NULL,entity TEXT NOT NULL,name TEXT NOT NULL,mime TEXT NOT NULL,bytes BLOB NOT NULL,created_at TEXT NOT NULL,author TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS requests(org TEXT NOT NULL,key TEXT NOT NULL,hash TEXT NOT NULL,result TEXT NOT NULL,PRIMARY KEY(org,key));
 CREATE TRIGGER IF NOT EXISTS audit_no_update BEFORE UPDATE ON audit BEGIN SELECT RAISE(ABORT,'Audit is append-only'); END;
 CREATE TRIGGER IF NOT EXISTS audit_no_delete BEFORE DELETE ON audit BEGIN SELECT RAISE(ABORT,'Audit is append-only'); END;
 CREATE TRIGGER IF NOT EXISTS ledger_no_update BEFORE UPDATE ON records WHEN OLD.kind='movement' BEGIN SELECT RAISE(ABORT,'Inventory ledger is append-only'); END;
 CREATE TRIGGER IF NOT EXISTS ledger_no_delete BEFORE DELETE ON records WHEN OLD.kind='movement' BEGIN SELECT RAISE(ABORT,'Inventory ledger is append-only'); END;
 INSERT OR IGNORE INTO migrations VALUES(1,datetime('now'));
 INSERT OR IGNORE INTO migrations VALUES(2,datetime('now'));
 CREATE TABLE IF NOT EXISTS commercial_access(org TEXT NOT NULL,user_id TEXT NOT NULL,PRIMARY KEY(org,user_id));
 CREATE TABLE IF NOT EXISTS commercial_pricing(org TEXT NOT NULL,id TEXT NOT NULL,version INTEGER NOT NULL,project_id TEXT NOT NULL,body TEXT NOT NULL,created_at TEXT NOT NULL,created_by TEXT NOT NULL,PRIMARY KEY(org,id,version));
 CREATE TABLE IF NOT EXISTS labor_rate_history(id TEXT PRIMARY KEY,org TEXT NOT NULL,worker_id TEXT NOT NULL,effective TEXT NOT NULL,before_body TEXT,after_body TEXT NOT NULL,created_at TEXT NOT NULL,created_by TEXT NOT NULL,reason TEXT NOT NULL);
 CREATE TRIGGER IF NOT EXISTS customer_price_no_update BEFORE UPDATE ON commercial_pricing BEGIN SELECT RAISE(ABORT,'Pricing revisions are append-only'); END;
 CREATE TRIGGER IF NOT EXISTS customer_price_no_delete BEFORE DELETE ON commercial_pricing BEGIN SELECT RAISE(ABORT,'Pricing revisions are append-only'); END;
 CREATE TRIGGER IF NOT EXISTS rate_history_no_update BEFORE UPDATE ON labor_rate_history BEGIN SELECT RAISE(ABORT,'Rate history is append-only'); END;
 CREATE TRIGGER IF NOT EXISTS rate_history_no_delete BEFORE DELETE ON labor_rate_history BEGIN SELECT RAISE(ABORT,'Rate history is append-only'); END;
 INSERT OR IGNORE INTO migrations VALUES(3,datetime('now'));
 `);
    if (
      !(this.db.prepare("PRAGMA table_info(users)").all() as any[]).some(
        (c) => c.name === "supplier_id",
      )
    )
      this.db.exec("ALTER TABLE users ADD COLUMN supplier_id TEXT");
    if (
      !(this.db.prepare("PRAGMA table_info(attachments)").all() as any[]).some(
        (c) => c.name === "vendor_visible",
      )
    )
      this.db.exec(
        "ALTER TABLE attachments ADD COLUMN vendor_visible INTEGER NOT NULL DEFAULT 0",
      );
    this.db.exec("INSERT OR IGNORE INTO migrations VALUES(4,datetime('now'))");
    if (
      !(this.db.prepare("PRAGMA table_info(sessions)").all() as any[]).some(
        (c) => c.name === "org_id",
      )
    )
      this.db.exec("ALTER TABLE sessions ADD COLUMN org_id TEXT");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS memberships(org TEXT NOT NULL,user_id TEXT NOT NULL,role TEXT NOT NULL,worker_id TEXT,supplier_id TEXT,active INTEGER NOT NULL DEFAULT 1,created_at TEXT NOT NULL,PRIMARY KEY(org,user_id));
      INSERT OR IGNORE INTO memberships SELECT org,id,role,worker_id,supplier_id,active,datetime('now') FROM users;
      CREATE TABLE IF NOT EXISTS org_owners(org TEXT PRIMARY KEY,user_id TEXT NOT NULL);
      INSERT OR IGNORE INTO org_owners SELECT org,id FROM users u WHERE role='admin' AND rowid=(SELECT min(rowid) FROM users x WHERE x.org=u.org AND x.role='admin');
      CREATE TABLE IF NOT EXISTS entitlements(org TEXT PRIMARY KEY,body TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS billing_accounts(org TEXT PRIMARY KEY,customer_id TEXT,subscription_id TEXT,plan TEXT,status TEXT,last_event_at INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS billing_events(id TEXT PRIMARY KEY,created INTEGER NOT NULL,type TEXT NOT NULL,processed_at TEXT NOT NULL);
      INSERT OR IGNORE INTO migrations VALUES(5,datetime('now'));
      CREATE TABLE IF NOT EXISTS task_material_state(org TEXT NOT NULL,task_id TEXT NOT NULL,status TEXT NOT NULL,digest TEXT NOT NULL,PRIMARY KEY(org,task_id));
      CREATE TABLE IF NOT EXISTS adapters(id TEXT PRIMARY KEY,org TEXT NOT NULL,name TEXT NOT NULL,endpoint TEXT NOT NULL,secret_env TEXT NOT NULL,enabled INTEGER NOT NULL,event_types TEXT NOT NULL,cursor INTEGER NOT NULL,version INTEGER NOT NULL,created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS adapter_deliveries(adapter_id TEXT NOT NULL,event_id TEXT NOT NULL,state TEXT NOT NULL,attempts INTEGER NOT NULL,next_at INTEGER NOT NULL,error TEXT,delivered_at TEXT,PRIMARY KEY(adapter_id,event_id));
      INSERT OR IGNORE INTO migrations VALUES(6,datetime('now'));
      CREATE TABLE IF NOT EXISTS billing_checkout(org TEXT PRIMARY KEY,plan TEXT NOT NULL,provider_key TEXT NOT NULL,expires INTEGER NOT NULL,body TEXT NOT NULL,url TEXT);
      INSERT OR IGNORE INTO migrations VALUES(7,datetime('now'));

    `);
  }
  tx<T>(fn: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const out = fn();
      this.db.exec("COMMIT");
      return out;
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }
  list(org: string, kind: string): RecordData[] {
    return (
      this.db
        .prepare(
          "SELECT body FROM records WHERE org=? AND kind=? ORDER BY rowid",
        )
        .all(org, kind) as any[]
    ).map((r) => JSON.parse(r.body));
  }
  get(org: string, kind: string, id: string): RecordData {
    const r = this.db
      .prepare("SELECT body FROM records WHERE org=? AND kind=? AND id=?")
      .get(org, kind, id) as any;
    requireThat(r, "Record not found", 404);
    return JSON.parse(r.body);
  }
  add(a: Actor, kind: string, body: any, id: string = randomUUID()) {
    const now = new Date().toISOString();
    const r = {
      ...body,
      id,
      version: 1,
      createdAt: now,
      updatedAt: now,
      createdBy: a.id,
    };
    this.db
      .prepare("INSERT INTO records VALUES(?,?,?,?)")
      .run(a.org, kind, id, JSON.stringify(r));
    this.db
      .prepare("INSERT INTO revisions VALUES(?,?,?,?,?)")
      .run(a.org, kind, id, 1, JSON.stringify(r));
    this.audit(a, kind + ".created", id, { version: 1 });
    this.event(a, kind, r, "created");
    return r;
  }
  update(a: Actor, kind: string, id: string, body: any, version: number) {
    const old = this.get(a.org, kind, id);
    requireThat(
      old.version === version,
      "This record changed. Refresh and try again.",
      409,
    );
    const r = {
      ...old,
      ...body,
      id,
      version: old.version + 1,
      updatedAt: new Date().toISOString(),
      createdBy: old.createdBy,
      createdAt: old.createdAt,
    };
    this.db
      .prepare("UPDATE records SET body=? WHERE org=? AND kind=? AND id=?")
      .run(JSON.stringify(r), a.org, kind, id);
    this.db
      .prepare("INSERT OR IGNORE INTO revisions VALUES(?,?,?,?,?)")
      .run(a.org, kind, id, old.version, JSON.stringify(old));
    this.db
      .prepare("INSERT INTO revisions VALUES(?,?,?,?,?)")
      .run(a.org, kind, id, r.version, JSON.stringify(r));
    this.audit(a, kind + ".updated", id, {
      fromVersion: old.version,
      toVersion: r.version,
      fields: Object.keys(body),
    });
    this.event(a, kind, r, "updated", old);
    return r;
  }
  event(
    a: Actor,
    kind: string,
    r: RecordData,
    action: string,
    old?: RecordData,
  ) {
    if (["notice", "eventStatus"].includes(kind)) return;
    const contract = eventContract(kind, r, action, old);
    this.emit(a, kind, r.id, contract.type, contract.data);
  }
  emit(
    a: Actor,
    kind: string,
    entity: string,
    eventType: string,
    payload: unknown,
  ) {
    this.db
      .prepare(
        "INSERT INTO outbox(id,org,actor,kind,entity,event_type,payload,created_at) VALUES(?,?,?,?,?,?,?,?)",
      )
      .run(
        randomUUID(),
        a.org,
        a.id,
        kind,
        entity,
        eventType,
        JSON.stringify(payload),
        new Date().toISOString(),
      );
  }
  audit(a: Actor, action: string, entity: string, detail: any = {}) {
    this.db
      .prepare(
        "INSERT INTO audit(id,org,actor,at,action,entity,detail) VALUES(?,?,?,?,?,?,?)",
      )
      .run(
        randomUUID(),
        a.org,
        a.id,
        new Date().toISOString(),
        action,
        entity,
        JSON.stringify(detail),
      );
  }
  auditList(org: string) {
    return this.db
      .prepare(
        "SELECT id,actor,at,action,entity,detail FROM audit WHERE org=? ORDER BY seq DESC LIMIT 500",
      )
      .all(org);
  }
  user(id: string, org?: string): Actor {
    const u = this.db
      .prepare("SELECT * FROM users WHERE id=? AND active=1")
      .get(id) as any;
    requireThat(u, "Sign in required", 401);
    const m = (
      org
        ? this.db
            .prepare(
              "SELECT * FROM memberships WHERE user_id=? AND org=? AND active=1",
            )
            .get(id, org)
        : this.db
            .prepare(
              "SELECT * FROM memberships WHERE user_id=? AND active=1 ORDER BY (org=?) DESC,created_at LIMIT 1",
            )
            .get(id, u.org)
    ) as any;
    requireThat(m, "Workspace membership is inactive or missing", 403);
    return {
      id: u.id,
      org: m.org,
      name: u.name,
      role: m.role,
      workerId: m.worker_id || undefined,
      supplierId: m.supplier_id || undefined,
    };
  }
  session(token: string): Actor {
    const s = this.db
      .prepare(
        "SELECT user_id,org_id FROM sessions WHERE token=? AND expires>?",
      )
      .get(hash(token), Date.now()) as any;
    requireThat(s, "Sign in required", 401);
    return this.user(s.user_id, s.org_id || undefined);
  }
  createUser(
    org: string,
    email: string,
    name: string,
    password: string,
    role: Role,
    workerId?: string,
    supplierId?: string,
  ) {
    requireThat(
      password.length >= 12,
      "Use at least 12 characters for passwords",
    );
    const id = randomUUID();
    this.db
      .prepare(
        "INSERT INTO users(id,org,email,name,password,role,worker_id,supplier_id) VALUES(?,?,?,?,?,?,?,?)",
      )
      .run(
        id,
        org,
        email.toLowerCase(),
        name,
        passwordHash(password),
        role,
        workerId || null,
        supplierId || null,
      );
    this.db
      .prepare("INSERT INTO memberships VALUES(?,?,?,?,?,?,?)")
      .run(
        org,
        id,
        role,
        workerId || null,
        supplierId || null,
        1,
        new Date().toISOString(),
      );
    if (role === "admin")
      this.db
        .prepare("INSERT OR IGNORE INTO org_owners VALUES(?,?)")
        .run(org, id);
    return this.user(id, org);
  }
  close() {
    this.db.close();
  }
}
