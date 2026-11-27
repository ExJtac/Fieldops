import { effectiveCrew, crewName } from "./crews.js";
import express from "express";
import {
  receiveBilling,
  billingView,
  checkout,
  billingPortal,
} from "./billing.js";
import {
  tenantList,
  createTenant,
  addMember,
  entitlements,
  guardEntitlement,
  owns,
} from "./tenants.js";
import { vendorRouteAllowed, vendorReply } from "./vendor.js";
import { advancedRoutes } from "./advanced-routes.js";
import { Advanced } from "./advanced.js";
import helmet from "helmet";
import { rateLimit } from "express-rate-limit";
import { randomBytes, randomUUID } from "node:crypto";
import { z } from "zod";
import ExcelJS from "exceljs";
import {
  Store,
  Fault,
  requireThat,
  passwordMatches,
  passwordHash,
  hash,
  type Actor,
} from "./store.js";
import { Operations } from "./domain.js";
import { schemas, roles, optionalDate, date, type Kind } from "./schemas.js";
import { seed } from "./seed.js";
import { previewImport, commitImport, decodeWorkbook } from "./imports.js";
export function createApp(store: Store) {
  const app = express(),
    ops = new Operations(store);
  const readOnly = process.env.DEMO_READ_ONLY === "true";
  const cookiePath = process.env.BASE_PATH || "/";
  app.disable("x-powered-by");
  app.use(
    helmet({
      contentSecurityPolicy:
        process.env.NODE_ENV === "production"
          ? {
              directives: {
                "script-src": ["'self'"],
                "style-src": ["'self'", "'unsafe-inline'"],
                "img-src": ["'self'", "data:"],
                "connect-src": ["'self'"],
              },
            }
          : false,
    }),
  );
  app.post(
    "/api/billing/webhook",
    express.raw({ type: "application/json", limit: "1mb" }),
    async (q, r) => {
      requireThat(!readOnly, "Public demonstration is read-only", 403);
      r.json(
        await receiveBilling(
          store,
          q.body,
          String(q.get("Stripe-Signature") || ""),
        ),
      );
    },
  );
  app.use(express.json({ limit: "16mb" }));
  app.use("/api", (_q, r, next) => {
    r.set("Cache-Control", "no-store");
    next();
  });
  app.use("/api", (req, _res, next) => {
    if (
      !["GET", "HEAD", "OPTIONS"].includes(req.method) &&
      req.headers.origin
    ) {
      const expected =
        process.env.APP_ORIGIN || `${req.protocol}://${req.get("host")}`;
      if (req.headers.origin !== expected)
        return next(new Fault("Origin not allowed", 403));
    }
    next();
  });
  app.get("/api/health", (_q, r) => r.json({ ok: true, version: "0.3.1" }));
  app.use("/api", (q, _r, next) => {
    if (readOnly && !["GET", "HEAD"].includes(q.method))
      return next(
        new Fault(
          "Public demonstration is read-only. Self-host FieldOps to save your own records.",
          403,
        ),
      );
    next();
  });
  app.get("/api/setup", (_q, r) =>
    r.json({
      required: !store.db.prepare("SELECT id FROM users LIMIT 1").get(),
    }),
  );
  const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 30,
    standardHeaders: "draft-8",
    legacyHeaders: false,
  });
  function signIn(res: express.Response, a: Actor) {
    const token = randomBytes(32).toString("hex");
    store.db
      .prepare("INSERT INTO sessions(token,user_id,expires) VALUES(?,?,?)")
      .run(hash(token), a.id, Date.now() + 12 * 3600000);
    res.cookie("fieldops_session", token, {
      httpOnly: true,
      sameSite: "strict",
      secure: process.env.COOKIE_SECURE === "true",
      maxAge: 12 * 3600000,
      path: cookiePath,
    });
    res.json({ actor: a });
  }
  app.post("/api/setup", authLimiter, (req, res) => {
    const b = z
      .object({
        organization: z.string().trim().min(1).max(200),
        email: z.email(),
        name: z.string().trim().min(1).max(200),
        password: z.string().min(12).max(256),
        demo: z.boolean().default(false),
      })
      .parse(req.body);
    const a = store.tx(() => {
      requireThat(
        !store.db.prepare("SELECT id FROM users LIMIT 1").get(),
        "Setup already complete",
        409,
      );
      const org = randomUUID();
      store.db
        .prepare("INSERT INTO organizations VALUES(?,?)")
        .run(org, b.organization);
      const user = store.createUser(org, b.email, b.name, b.password, "admin");
      store.add(user, "settings", { separation: false });
      if (b.demo) seed(ops, user);
      return user;
    });
    signIn(res, a);
  });
  app.post("/api/login", authLimiter, (req, res) => {
    const b = z
      .object({ email: z.email(), password: z.string().max(256) })
      .parse(req.body);
    const u = store.db
      .prepare("SELECT * FROM users WHERE email=? AND active=1")
      .get(b.email.toLowerCase()) as any;
    requireThat(
      u && passwordMatches(b.password, u.password),
      "Email or password is incorrect",
      401,
    );
    signIn(res, store.user(u.id));
  });
  app.use("/api", (req, res, next) => {
    try {
      if (readOnly) {
        const u = store.db.prepare("SELECT id FROM users LIMIT 1").get() as any;
        requireThat(u, "Demo has not been initialized", 503);
        const demoActor = store.user(u.id);
        requireThat(
          store
            .list(demoActor.org, "settings")
            .some((s) => s.publicDemo === true),
          "This database is not marked as a public demonstration",
          503,
        );
        res.locals.actor = store.user(u.id);
        return next();
      }
      const token = req.headers.cookie
        ?.split(";")
        .map((s) => s.trim())
        .find((s) => s.startsWith("fieldops_session="))
        ?.slice(17);
      requireThat(token, "Sign in required", 401);
      res.locals.actor = store.session(token);
      next();
    } catch (e) {
      next(e);
    }
  });
  app.post("/api/logout", (req, res) => {
    const token = req.headers.cookie
      ?.split(";")
      .map((s) => s.trim())
      .find((s) => s.startsWith("fieldops_session="))
      ?.slice(17);
    if (token)
      store.db.prepare("DELETE FROM sessions WHERE token=?").run(hash(token));
    res.clearCookie("fieldops_session", { path: cookiePath });
    res.json({ ok: true });
  });
  app.use("/api/v1", (q, r, next) => {
    if (
      r.locals.actor.role === "vendor" &&
      !vendorRouteAllowed(q.method, q.path)
    )
      return next(new Fault("Supplier portal action is not permitted", 403));
    next();
  });
  app.use("/api/v1", (q, r, next) => {
    if (!["POST", "PATCH", "DELETE"].includes(q.method)) return next();
    const path = q.path;
    if (
      /^\/(records|inventory|assignments|crews|imports|intake|planning|purchase-orders)\//.test(
        path,
      ) ||
      path.startsWith("/operations/")
    ) {
      const action = path.split("/").at(-1) || "",
        exempt = ["grants", "dispatch", "retryEvent"];
      if (!exempt.includes(action)) {
        const map: Record<string, string> = {
          assetMove: "movement",
          quoteToPo: "po",
          vendorPromise: "po",
          shortageRfqs: "rfq",
          cancelTimer: "time",
          workerReview: "time",
          rate: "time",
          demobilize: "crewMembership",
        };
        const kind = path.startsWith("/records/")
          ? path.split("/")[2]
          : path.startsWith("/intake/po/") ||
              path.startsWith("/purchase-orders/")
            ? "po"
            : path.startsWith("/intake/estimate/")
              ? "requirement"
              : path.startsWith("/planning/") ||
                  path.startsWith("/assignments/")
                ? "assignment"
                : map[action] || action;
        guardEntitlement(
          store,
          r.locals.actor,
          kind === "project" ? "project-edit" : kind,
        );
      }
    }
    next();
  });
  const write = (req: express.Request, res: express.Response, fn: () => any) =>
    res.json(
      vendorReply(
        store,
        res.locals.actor,
        req.path,
        ops.write(
          res.locals.actor,
          String(req.get("Idempotency-Key") || ""),
          { method: req.method, path: req.path, body: req.body },
          fn,
        ),
      ),
    );
  app.get("/api/v1/billing", (_q, r) =>
    r.json(billingView(store, r.locals.actor)),
  );
  app.post("/api/v1/billing/checkout", authLimiter, async (q, r) =>
    r.json(
      await checkout(
        store,
        r.locals.actor,
        z.string().parse(q.body.plan),
        String(q.get("Idempotency-Key") || ""),
      ),
    ),
  );
  app.post("/api/v1/billing/portal", authLimiter, async (q, r) =>
    r.json(
      await billingPortal(
        store,
        r.locals.actor,
        String(q.get("Idempotency-Key") || ""),
      ),
    ),
  );
  app.get("/api/v1/tenants", (_q, r) =>
    r.json({
      workspaces: tenantList(store, r.locals.actor),
      entitlements: entitlements(store, r.locals.actor),
    }),
  );
  app.post("/api/v1/tenants", (q, r) =>
    write(q, r, () => createTenant(store, r.locals.actor, q.body.name)),
  );
  app.post("/api/v1/tenants/members", (q, r) =>
    write(q, r, () => {
      guardEntitlement(store, r.locals.actor, "member");
      return addMember(ops, r.locals.actor, q.body);
    }),
  );
  app.post("/api/v1/tenants/owner", (q, r) =>
    write(q, r, () => {
      const a = r.locals.actor;
      requireThat(owns(store, a), "Workspace owner required", 403);
      const target = store.db
        .prepare(
          "SELECT u.id FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.org=? AND m.active=1 AND m.role='admin' AND u.active=1 AND u.email=?",
        )
        .get(a.org, z.email().parse(q.body.email).toLowerCase()) as any;
      requireThat(target, "Choose an active administrator in this workspace");
      store.db
        .prepare("UPDATE org_owners SET user_id=? WHERE org=?")
        .run(target.id, a.org);
      store.audit(a, "ownership.transferred", target.id);
      return { ok: true };
    }),
  );
  app.post("/api/v1/tenants/switch", (q, r) => {
    const actor = store.user(r.locals.actor.id, z.string().parse(q.body.org));
    const token = q.headers.cookie
      ?.split(";")
      .map((x) => x.trim())
      .find((x) => x.startsWith("fieldops_session="))
      ?.slice(17);
    requireThat(token, "Sign in required", 401);
    store.db
      .prepare("UPDATE sessions SET org_id=? WHERE token=?")
      .run(actor.org, hash(token));
    r.json({ actor });
  });
  app.get("/api/v1/workspace", (_q, r) =>
    r.json({
      ...ops.snapshot(r.locals.actor),
      readOnly,
      entitlements: entitlements(store, r.locals.actor),
    }),
  );
  app.post("/api/v1/records/:kind", (q, r) => {
    requireThat(q.params.kind in schemas, "Unknown record type", 404);
    write(q, r, () =>
      ops.create(r.locals.actor, q.params.kind as Kind, q.body),
    );
  });
  app.patch("/api/v1/records/:kind/:id", (q, r) => {
    requireThat(q.params.kind in schemas, "Unknown record type", 404);
    write(q, r, () =>
      ops.edit(r.locals.actor, q.params.kind as Kind, q.params.id, q.body),
    );
  });
  app.post("/api/v1/records/:kind/:id/transition", (q, r) =>
    write(q, r, () =>
      [
        "shipment",
        "notice",
        "quote",
        "conversion",
        "poAmendment",
        "credit",
        "adjustment",
        "scheduleRevision",
        "productionCorrection",
        "availability",
      ].includes(q.params.kind)
        ? new Advanced(ops).transition(
            r.locals.actor,
            q.params.kind,
            q.params.id,
            q.body,
          )
        : ops.transition(r.locals.actor, q.params.kind, q.params.id, q.body),
    ),
  );
  app.post("/api/v1/inventory/movements", (q, r) =>
    write(q, r, () => ops.movement(r.locals.actor, q.body)),
  );
  app.post("/api/v1/assignments/preview", (q, r) => {
    ops.allowed(r.locals.actor, "assignment");
    r.json({
      conflicts: ops.assignmentConflicts(
        r.locals.actor,
        schemas.assignment.parse(q.body),
        q.body.id,
      ),
    });
  });
  app.patch("/api/v1/assignments/:id", (q, r) =>
    write(q, r, () => ops.moveAssignment(r.locals.actor, q.params.id, q.body)),
  );
  app.post("/api/v1/assignments/:id/cancel", (q, r) =>
    write(q, r, () => {
      ops.allowed(r.locals.actor, "assignment");
      ops.ref(r.locals.actor, "assignment", q.params.id);
      return store.update(
        r.locals.actor,
        "assignment",
        q.params.id,
        { status: "Cancelled" },
        z.number().int().parse(q.body.version),
      );
    }),
  );
  app.post("/api/v1/purchase-orders/:id/promises", (q, r) =>
    write(q, r, () => {
      const a = r.locals.actor;
      ops.allowed(a, "po");
      const po = ops.ref(a, "po", q.params.id);
      requireThat(
        ["Issued", "Acknowledged"].includes(po.status),
        "Only issued or acknowledged orders have supplier promises",
      );
      const b = z
        .object({
          version: z.number().int(),
          lines: z.array(
            z.object({
              id: z.string(),
              confirmedETA: optionalDate,
              ackDate: optionalDate,
              leadMin: z.number().int().min(0).max(3650),
              leadMax: z.number().int().min(0).max(3650),
            }),
          ),
        })
        .parse(q.body);
      requireThat(
        b.lines.length === po.lines.length &&
          new Set(b.lines.map((l) => l.id)).size === po.lines.length,
        "Every existing line must be included once",
      );
      const lines = po.lines.map((l: any) => {
        const promise = b.lines.find((x) => x.id === l.id);
        requireThat(
          promise && promise.leadMax >= promise.leadMin,
          "Invalid promise line",
        );
        return { ...l, ...promise };
      });
      store.audit(a, "supplier.promise_changed", po.id, {
        before: po.lines.map((l: any) => ({
          id: l.id,
          confirmedETA: l.confirmedETA,
          ackDate: l.ackDate,
        })),
        after: b.lines,
      });
      return store.update(a, "po", po.id, { lines }, b.version);
    }),
  );
  function attachmentAccess(a: Actor, kind: string, id: string) {
    const r = ops.ref(a, kind, id);
    requireThat(
      a.role !== "viewer",
      "Attachments are restricted to operations staff",
      403,
    );
    if (a.role === "worker")
      requireThat(
        ["time", "production"].includes(kind) && r.workerId === a.workerId,
        "Only your own time or production evidence is available",
        403,
      );
    if (a.role === "vendor") return r;
    if (["quote", "po", "supplier", "rfq"].includes(kind))
      requireThat(
        ["admin", "purchasing"].includes(a.role),
        "Supplier documents are restricted",
        403,
      );
    return r;
  }
  app.get("/api/v1/attachments", (q, r) => {
    const kind = String(q.query.kind),
      id = String(q.query.id);
    attachmentAccess(r.locals.actor, kind, id);
    r.json(
      store.db
        .prepare(
          "SELECT id,name,mime,created_at,vendor_visible FROM attachments WHERE org=? AND kind=? AND entity=?" +
            (r.locals.actor.role === "vendor" ? " AND vendor_visible=1" : ""),
        )
        .all(r.locals.actor.org, kind, id),
    );
  });
  app.post("/api/v1/attachments", (q, r) =>
    write(q, r, () => {
      const a = r.locals.actor,
        b = z
          .object({
            kind: z.enum([
              "movement",
              "po",
              "quote",
              "shipment",
              "time",
              "production",
              "hold",
              "change",
            ]),
            entity: z.string(),
            name: z.string().min(1).max(200),
            mime: z.enum(["image/jpeg", "image/png", "application/pdf"]),
            base64: z.string().max(8_000_000),
            vendorVisible: z.boolean().default(false),
          })
          .parse(q.body);
      attachmentAccess(a, b.kind, b.entity);
      if (a.role === "vendor")
        requireThat(
          ["quote", "shipment"].includes(b.kind),
          "Suppliers may upload quote or shipment evidence",
          403,
        );
      if (b.vendorVisible)
        requireThat(
          ["admin", "purchasing", "vendor"].includes(a.role),
          "Purchasing permission required to share supplier evidence",
          403,
        );
      const bytes = Buffer.from(b.base64, "base64");
      requireThat(
        bytes.length > 0 && bytes.length <= 5_000_000,
        "Files must be at most 5 MB",
      );
      guardEntitlement(store, a, "attachment", bytes.length);
      const valid =
        b.mime === "application/pdf"
          ? bytes.subarray(0, 5).toString() === "%PDF-"
          : b.mime === "image/png"
            ? bytes.subarray(0, 8).toString("hex") === "89504e470d0a1a0a"
            : bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
      requireThat(valid, "File content does not match its type");
      const id = randomUUID();
      store.db
        .prepare(
          "INSERT INTO attachments(id,org,kind,entity,name,mime,bytes,created_at,author,vendor_visible) VALUES(?,?,?,?,?,?,?,?,?,?)",
        )
        .run(
          id,
          a.org,
          b.kind,
          b.entity,
          b.name,
          b.mime,
          bytes,
          new Date().toISOString(),
          a.id,
          a.role === "vendor" || b.vendorVisible ? 1 : 0,
        );
      store.audit(a, "attachment.added", b.entity, { id, name: b.name });
      return { id };
    }),
  );
  app.get("/api/v1/attachments/:id", (q, r) => {
    const a = r.locals.actor,
      row = store.db
        .prepare("SELECT * FROM attachments WHERE org=? AND id=?")
        .get(a.org, q.params.id) as any;
    requireThat(row, "Attachment not found", 404);
    attachmentAccess(a, row.kind, row.entity);
    requireThat(
      a.role !== "vendor" || row.vendor_visible === 1,
      "File is not shared with suppliers",
      403,
    );
    r.type(row.mime).attachment(row.name).send(Buffer.from(row.bytes));
  });
  app.post("/api/v1/imports/preview", async (q, r) => {
    ops.allowed(r.locals.actor, "requirement");
    let rows = q.body.rows;
    if (q.body.base64)
      rows = await decodeWorkbook(q.body.base64, q.body.format);
    r.json({
      rows,
      preview: previewImport(ops, r.locals.actor, q.body.projectId, rows),
    });
  });
  app.post("/api/v1/imports/commit", (q, r) =>
    write(q, r, () => commitImport(ops, r.locals.actor, q.body)),
  );
  app.post("/api/v1/demo", (q, r) =>
    write(q, r, () => seed(ops, r.locals.actor)),
  );
  app.get("/api/v1/users", (_q, r) => {
    requireThat(r.locals.actor.role === "admin", "Administrator required", 403);
    r.json(
      store.db
        .prepare(
          "SELECT u.id,u.name,u.email,m.role,m.worker_id AS workerId,m.supplier_id AS supplierId,m.active FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.org=?",
        )
        .all(r.locals.actor.org),
    );
  });
  app.post("/api/v1/users", (q, r) =>
    write(q, r, () => {
      requireThat(
        r.locals.actor.role === "admin",
        "Administrator required",
        403,
      );
      const b = z
        .object({
          email: z.email(),
          name: z.string().min(1).max(200),
          password: z.string().min(12).max(256),
          role: z.enum(roles),
          workerId: z.string().optional(),
          supplierId: z.string().optional(),
        })
        .parse(q.body);
      if (b.supplierId) ops.ref(r.locals.actor, "supplier", b.supplierId);
      requireThat(
        b.role !== "vendor" || b.supplierId,
        "Supplier accounts require a supplier record",
      );
      if (b.workerId) ops.ref(r.locals.actor, "worker", b.workerId);
      requireThat(
        b.role !== "worker" || b.workerId,
        "Worker accounts require a worker record",
      );
      guardEntitlement(store, r.locals.actor, "member");
      const u = store.createUser(
        r.locals.actor.org,
        b.email,
        b.name,
        b.password,
        b.role,
        b.workerId,
        b.supplierId,
      );
      store.audit(r.locals.actor, "user.created", u.id, { role: b.role });
      return u;
    }),
  );
  app.post("/api/v1/me/password", authLimiter, (q, r) =>
    write(q, r, () => {
      const a = r.locals.actor,
        b = z
          .object({
            currentPassword: z.string().max(256),
            password: z.string().min(12).max(256),
          })
          .parse(q.body);
      const user = store.db
        .prepare("SELECT password FROM users WHERE id=?")
        .get(a.id) as any;
      requireThat(
        passwordMatches(b.currentPassword, user.password),
        "Current password is incorrect",
        403,
      );
      store.db
        .prepare("UPDATE users SET password=? WHERE id=?")
        .run(passwordHash(b.password), a.id);
      store.db.prepare("DELETE FROM sessions WHERE user_id=?").run(a.id);
      store.audit(a, "user.password_changed", a.id);
      return { ok: true };
    }),
  );
  app.post("/api/v1/users/:id/active", (q, r) =>
    write(q, r, () => {
      const a = r.locals.actor;
      requireThat(a.role === "admin", "Administrator required", 403);
      requireThat(
        q.params.id !== a.id,
        "You cannot deactivate your own account",
      );
      requireThat(
        !store.db
          .prepare("SELECT 1 FROM org_owners WHERE org=? AND user_id=?")
          .get(a.org, q.params.id),
        "Transfer workspace ownership before deactivating its owner",
      );
      const target = store.db
        .prepare(
          "SELECT user_id,active FROM memberships WHERE user_id=? AND org=?",
        )
        .get(q.params.id, a.org) as
        { user_id: string; active: number } | undefined;
      requireThat(target, "Account not found", 404);
      const active = z.boolean().parse(q.body.active);
      if (active && !target!.active) guardEntitlement(store, a, "member");
      store.db
        .prepare("UPDATE memberships SET active=? WHERE user_id=? AND org=?")
        .run(active ? 1 : 0, q.params.id, a.org);
      if (!active)
        store.db
          .prepare(
            "DELETE FROM sessions WHERE user_id=? AND (org_id=? OR org_id IS NULL)",
          )
          .run(q.params.id, a.org);
      store.audit(
        a,
        active ? "user.activated" : "user.deactivated",
        q.params.id,
      );
      return { ok: true };
    }),
  );
  app.post("/api/v1/crews/:kind", (q, r) =>
    write(q, r, () => {
      const a = r.locals.actor,
        kind = q.params.kind;
      requireThat(
        ["time", "assignment"].includes(kind),
        "Unknown crew operation",
      );
      requireThat(
        ["admin", "pm", "foreman"].includes(a.role),
        "Manager or foreman required",
        403,
      );
      ops.allowed(a, kind);
      const day = date.parse(q.body.date),
        crewId = z.string().parse(q.body.crewId || ""),
        crew = z
          .string()
          .trim()
          .parse(q.body.crew || "");
      requireThat(
        crewId || crew,
        "Select a dated crew or enter a legacy crew name",
      );
      if (crewId) ops.ref(a, "crew", crewId);
      const workers = ops
        .all(a, "worker")
        .filter(
          (w) =>
            w.active &&
            (crewId
              ? effectiveCrew(store, a, w.id, day)?.crew.id === crewId
              : crewName(store, a, w.id, day) === crew),
        );
      requireThat(
        workers.length > 0 && workers.length <= 100,
        "Select a crew with 1–100 active workers",
      );
      const records = workers.map((w) =>
        ops.create(a, kind as Kind, { ...q.body, workerId: w.id }),
      );
      return { count: records.length, records };
    }),
  );
  app.post("/api/v1/settings", (q, r) =>
    write(q, r, () => {
      requireThat(
        r.locals.actor.role === "admin",
        "Administrator required",
        403,
      );
      const b = z
          .object({ separation: z.boolean(), version: z.number().int() })
          .parse(q.body),
        s = ops.all(r.locals.actor, "settings")[0];
      return store.update(
        r.locals.actor,
        "settings",
        s.id,
        { separation: b.separation },
        b.version,
      );
    }),
  );
  advancedRoutes(app, ops);
  app.get("/api/v1/reports/:format", async (q, r) => {
    const a = r.locals.actor as Actor,
      s = ops.snapshot(a);
    const project = String(q.query.projectId || ""),
      section = String(q.query.section || "");
    if (project) ops.ref(a, "project", project);
    const forecasts = s.forecast.filter(
      (f: any) =>
        (!project || f.projectId === project) &&
        (!section || f.section === section),
    );
    const readiness = s.readiness.filter(
      (f: any) =>
        (!project || f.projectId === project) &&
        (!section || f.section === section),
    );
    if (q.params.format === "json") {
      r.attachment("fieldops-operations-v1.json").json({
        schemaVersion: 1,
        exportedAt: new Date().toISOString(),
        projects: s.data.project.filter(
          (p: any) => !project || p.id === project,
        ),
        readiness,
        forecast: forecasts,
      });
      return;
    }
    requireThat(
      ["csv", "xlsx"].includes(q.params.format),
      "Unknown format",
      404,
    );
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Labor");
    sheet.columns = Object.keys(
      forecasts[0] || { name: "", section: "", actual: 0 },
    ).map((key) => ({ header: key, key, width: 22 }));
    forecasts.forEach((row: any) => sheet.addRow(row));
    const materials = workbook.addWorksheet("Readiness");
    materials.columns = [
      "projectId",
      "taskId",
      "name",
      "section",
      "status",
      "reason",
    ].map((key) => ({ header: key, key, width: 28 }));
    readiness.forEach((row: any) => materials.addRow(row));
    for (const ws of workbook.worksheets) {
      ws.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
      ws.getRow(1).fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "FF163B35" },
      };
      ws.views = [{ state: "frozen", ySplit: 1 }];
    }
    r.attachment("fieldops-report." + q.params.format);
    if (q.params.format === "xlsx") {
      r.type(
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      );
      r.send(Buffer.from(await workbook.xlsx.writeBuffer()));
    } else {
      const clean = (v: any) =>
        '"' +
        String(v ?? "")
          .replace(/^[=+@\-\t\r]/, "'$&")
          .replaceAll('"', '""') +
        '"';
      const cols = sheet.columns.map((c) => String(c.key));
      r.type("text/csv").send(
        [cols, ...forecasts.map((f: any) => cols.map((c) => f[c]))]
          .map((row) => row.map(clean).join(","))
          .join("\r\n"),
      );
    }
  });
  app.use("/api", (_q, _r, next) =>
    next(new Fault("API route not found", 404)),
  );
  app.use(
    (
      e: any,
      _q: express.Request,
      r: express.Response,
      _next: express.NextFunction,
    ) => {
      if (e instanceof z.ZodError)
        return r.status(400).json({
          error: e.issues
            .map((i) => i.path.join(".") + ": " + i.message)
            .join("; "),
        });
      const status =
        e instanceof Fault ? e.status : e.status === 413 ? 413 : 500;
      if (status === 500) console.error(e);
      r.status(status).json({
        error:
          status === 500
            ? "Unable to save this operation. Check server logs."
            : e.message,
      });
    },
  );
  return app;
}
