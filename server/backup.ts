import { DatabaseSync, backup } from "node:sqlite";
import { mkdirSync } from "node:fs";
const db = new DatabaseSync(
  process.env.DATABASE_PATH || "data/fieldops.sqlite",
);
mkdirSync("data/backups", { recursive: true });
const file =
  "data/backups/fieldops-" +
  new Date().toISOString().replaceAll(":", "-") +
  ".sqlite";
await backup(db, file);
db.close();
console.log("Consistent SQLite backup saved:", file);
