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
  "admin" | "pm" | "purchasing" | "foreman" | "worker" | "viewer";
export type Actor = {
  id: string;
  org: string;
  name: string;
  role: Role;
  workerId?: string;
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
    this.event(a, kind, r, "updated");
    return r;
  }
  event(a: Actor, kind: string, r: RecordData, action: string) {
    if (["notice", "eventStatus"].includes(kind)) return;
    this.db
      .prepare(
        "INSERT INTO outbox(id,org,actor,kind,entity,event_type,payload,created_at) VALUES(?,?,?,?,?,?,?,?)",
      )
      .run(
        randomUUID(),
        a.org,
        a.id,
        kind,
        r.id,
        kind + "." + action,
        JSON.stringify({
          projectId: r.projectId || null,
          workerId: r.workerId || null,
          version: r.version,
          status: r.status || null,
          date: r.date || null,
          hours: r.hours || null,
        }),
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
  user(id: string): Actor {
    const u = this.db
      .prepare("SELECT * FROM users WHERE id=? AND active=1")
      .get(id) as any;
    requireThat(u, "Sign in required", 401);
    return {
      id: u.id,
      org: u.org,
      name: u.name,
      role: u.role,
      workerId: u.worker_id || undefined,
    };
  }
  session(token: string): Actor {
    const s = this.db
      .prepare("SELECT user_id FROM sessions WHERE token=? AND expires>?")
      .get(hash(token), Date.now()) as any;
    requireThat(s, "Sign in required", 401);
    return this.user(s.user_id);
  }
  createUser(
    org: string,
    email: string,
    name: string,
    password: string,
    role: Role,
    workerId?: string,
  ) {
    requireThat(
      password.length >= 12,
      "Use at least 12 characters for passwords",
    );
    const id = randomUUID();
    this.db
      .prepare(
        "INSERT INTO users(id,org,email,name,password,role,worker_id) VALUES(?,?,?,?,?,?,?)",
      )
      .run(
        id,
        org,
        email.toLowerCase(),
        name,
        passwordHash(password),
        role,
        workerId || null,
      );
    return this.user(id);
  }
  close() {
    this.db.close();
  }
}
