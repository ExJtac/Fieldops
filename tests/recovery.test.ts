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
