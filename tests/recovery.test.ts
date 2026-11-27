import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { backup } from "node:sqlite";
import { Store, type Actor } from "../server/store.js";

test("records, immutable audit and revisions survive reopen and consistent backup restore", async () => {
  const dir = mkdtempSync(join(tmpdir(), "fieldops-recovery-")),
    path = join(dir, "live.sqlite"),
    copy = join(dir, "backup.sqlite");
  let s = new Store(path);
  const a: Actor = { id: "admin", org: "test", name: "Admin", role: "admin" };
  try {
    s.db.prepare("INSERT INTO organizations VALUES(?,?)").run("test", "Test");
    const p = s.tx(() => s.add(a, "project", { name: "First" }));
    s.tx(() => s.update(a, "project", p.id, { name: "Revised" }, p.version));
    await backup(s.db, copy);
    s.close();
    s = new Store(copy);
    assert.equal(s.get(a.org, "project", p.id).name, "Revised");
    assert.equal(
      s.db.prepare("SELECT COUNT(*) AS n FROM revisions").get()!.n,
      2,
    );
    assert.equal(s.auditList(a.org).length, 2);
    assert.throws(() => s.db.exec("DELETE FROM audit"), /append-only/);
  } finally {
    s.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("legacy accounts migrate once; multi-workspace memberships and private stores survive backup", async () => {
  const dir = mkdtempSync(join(tmpdir(), "fieldops-migration-")),
    path = join(dir, "legacy.sqlite"),
    copy = join(dir, "restored.sqlite");
  let s = new Store(path);
  try {
    s.db
      .prepare("INSERT INTO organizations VALUES(?,?)")
      .run("legacy", "Legacy");
    const a = s.createUser(
      "legacy",
      "legacy@test.invalid",
      "Legacy",
      "test-only-password",
      "admin",
    );
    s.db
      .prepare("INSERT INTO labor_rates VALUES(?,?,?,?,?,?)")
      .run(a.org, "worker", "2026-01-01", 25, 1.5, "USD");
    s.db
      .prepare("INSERT INTO commercial_pricing VALUES(?,?,?,?,?,?,?)")
      .run(
        a.org,
        "price",
        1,
        "project",
        JSON.stringify({ id: "price", unitSell: 45 }),
        "2026-01-01",
        a.id,
      );
    s.db
      .prepare("INSERT INTO sessions(token,user_id,expires) VALUES(?,?,?)")
      .run("legacy-token", a.id, Date.now() + 60000);
    // Emulate pre-membership schema without changing the legacy user or session columns.
    s.db.exec(
      "DROP TABLE memberships; DROP TABLE org_owners; DELETE FROM migrations WHERE version>=5",
    );
    s.close();
    s = new Store(path);
    assert.equal(s.user(a.id).role, "admin");
    assert.equal(
      s.db.prepare("SELECT count(*) n FROM memberships").get()!.n,
      1,
    );
    s.db.prepare("UPDATE memberships SET active=0 WHERE user_id=?").run(a.id);
    await backup(s.db, copy);
    s.close();
    s = new Store(copy);
    assert.throws(() => s.user(a.id), /inactive/);
    assert.equal(s.db.prepare("SELECT rate FROM labor_rates").get()!.rate, 25);
    assert.equal(
      s.db.prepare("SELECT count(*) n FROM commercial_pricing").get()!.n,
      1,
    );
    assert.equal(
      s.db.prepare("SELECT max(version) n FROM migrations").get()!.n,
      7,
    );
    assert.throws(
      () => s.db.exec("DELETE FROM commercial_pricing"),
      /append-only/,
    );
  } finally {
    s.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
