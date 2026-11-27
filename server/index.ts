import { createApp } from "./app.js";
import { Store } from "./store.js";
import { randomBytes, randomUUID } from "node:crypto";
import { Operations } from "./domain.js";
import { seed } from "./seed.js";
import { resolve } from "node:path";
const store = new Store(process.env.DATABASE_PATH || "data/fieldops.sqlite");
if (
  process.env.DEMO_READ_ONLY === "true" &&
  !store.db.prepare("SELECT id FROM users LIMIT 1").get()
)
  store.tx(() => {
    const org = randomUUID();
    store.db
      .prepare("INSERT INTO organizations VALUES(?,?)")
      .run(org, "Public demonstration");
    const a = store.createUser(
      org,
      "demo@fieldops.invalid",
      "Demonstration workspace",
      randomBytes(32).toString("hex"),
      "admin",
    );
    store.add(a, "settings", { separation: false, publicDemo: true });
    seed(new Operations(store), a);
  });
const app = createApp(store);
if (process.env.NODE_ENV === "production") {
  const express = (await import("express")).default;
  app.use(express.static(resolve("dist")));
  app.get("/{*path}", (_q, r) => r.sendFile(resolve("dist/index.html")));
} else {
  const { createServer } = await import("vite");
  const vite = await createServer({
    server: { middlewareMode: true },
    appType: "spa",
  });
  app.use(vite.middlewares);
}
const port = Number(process.env.PORT || 4328),
  host = process.env.HOST || "127.0.0.1";
const server = app.listen(port, host, () =>
  console.log(`CAS FieldOps running at http://${host}:${port}`),
);
process.on("SIGTERM", () =>
  server.close(() => {
    store.close();
    process.exit(0);
  }),
);
